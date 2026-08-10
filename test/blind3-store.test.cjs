// Blind oracle: ContextBlockStore list semantics (phase3-surface.md
// "src/core/contextBlocks.ts" + "Store semantics"). Written against the
// surface doc only; never read src/**. Expected red while stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind3-store",
  `export { ContextBlockStore } from "../src/core/contextBlocks";\n`
);
const { ContextBlockStore } = mod;
test.after(cleanup);

const input = (uri, text, version = 1, startLine = 1, endLine = 1) => ({
  uri,
  range: { startLine, endLine },
  text,
  version,
});
const A = () => input("file:///w/a.rs", "alpha text", 7, 3, 9);
const B = () => input("file:///w/b.rs", "beta text", 2, 1, 4);
const C = () => input("file:///w/c.rs", "gamma text", 5, 10, 12);
const D = () => input("file:///w/d.rs", "delta text", 9, 2, 2);

// ---- add [surface: Store semantics 'add appends to the end and returns the stored entry']

test("add returns the stored entry with exactly the documented fields, text verbatim [surface: ContextBlockEntry; 'no trimming, no EOL normalization']", () => {
  const store = new ContextBlockStore();
  const raw = "  keep \r\n\tme verbatim \n";
  const e = store.add(input("file:///w/a.rs", raw, 7, 3, 9));
  assert.deepStrictEqual(Object.keys(e).sort(), ["addedAtVersion", "id", "range", "text", "uri"]);
  assert.strictEqual(e.uri, "file:///w/a.rs");
  assert.deepStrictEqual(e.range, { startLine: 3, endLine: 9 });
  assert.strictEqual(e.text, raw, "verbatim: no trimming, no EOL normalization");
  assert.strictEqual(e.addedAtVersion, 7);
});

test("empty text is legal: the store is dumb, gesture guards live in the vscode layer [surface: 'Empty text is legal']", () => {
  const store = new ContextBlockStore();
  const e = store.add(input("file:///w/a.rs", "", 1));
  assert.strictEqual(e.text, "");
  assert.strictEqual(store.list().length, 1);
});

test("add appends: list() is insertion order [surface: 'add appends to the end'; 'list(): current entries in order']", () => {
  const store = new ContextBlockStore();
  store.add(A());
  store.add(B());
  store.add(C());
  assert.deepStrictEqual(
    store.list().map((e) => e.uri),
    ["file:///w/a.rs", "file:///w/b.rs", "file:///w/c.rs"]
  );
});

test("no dedup: adding the same region twice creates two entries with distinct ids, twice in the projection [surface: 'No dedup']", () => {
  const store = new ContextBlockStore();
  const e1 = store.add(A());
  const e2 = store.add(A());
  assert.notStrictEqual(e1.id, e2.id);
  assert.strictEqual(store.list().length, 2);
  const pb = store.toPromptBlocks();
  assert.strictEqual(pb.length, 2, "twice in the list means twice in the prompt");
  assert.deepStrictEqual(pb[0], pb[1]);
});

// ---- ids [surface: 'ids are per store instance, strictly increasing, never reused']

test("ids are 'b1','b2',... strictly increasing; remove and clear do not reset the counter [surface: ContextBlockEntry id comment + last Store semantics bullet]", () => {
  const store = new ContextBlockStore();
  const e1 = store.add(A());
  const e2 = store.add(B());
  assert.strictEqual(e1.id, "b1");
  assert.strictEqual(e2.id, "b2");
  assert.strictEqual(store.remove(e1.id), true);
  const e3 = store.add(C());
  assert.strictEqual(e3.id, "b3", "remove does not free an id for reuse");
  store.clear();
  const e4 = store.add(D());
  assert.strictEqual(e4.id, "b4", "clear does not reset the counter");
  const other = new ContextBlockStore();
  assert.strictEqual(other.add(A()).id, "b1", "ids are store-scoped");
});

// ---- remove [surface: 'remove(id): on a hit, deletes the entry, returns true. Unknown id returns false']

test("remove: hit deletes and returns true; unknown id returns false; a second remove of the same id is a miss", () => {
  const store = new ContextBlockStore();
  const e1 = store.add(A());
  const e2 = store.add(B());
  assert.strictEqual(store.remove(e1.id), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [e2.id]);
  assert.strictEqual(store.remove(e1.id), false, "already-removed id is unknown");
  assert.strictEqual(store.remove("nope"), false);
  assert.strictEqual(store.list().length, 1, "misses change nothing");
});

// ---- clear [surface: 'clear(): empties the store, returns the number of entries removed']

test("clear returns the removed count and empties the store; clear on empty returns 0", () => {
  const store = new ContextBlockStore();
  store.add(A());
  store.add(B());
  store.add(C());
  assert.strictEqual(store.clear(), 3);
  assert.deepStrictEqual([...store.list()], []);
  assert.strictEqual(store.clear(), 0, "clear is an unconditional gesture, not a lookup");
});

// ---- move [surface: 'move(id, direction): swaps the entry with its neighbor']

test("move swaps with the neighbor and returns true; list order reflects the swap", () => {
  const store = new ContextBlockStore();
  const e1 = store.add(A());
  const e2 = store.add(B());
  const e3 = store.add(C());
  assert.strictEqual(store.move(e2.id, "up"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [e2.id, e1.id, e3.id]);
  assert.strictEqual(store.move(e2.id, "down"), true);
  assert.deepStrictEqual(store.list().map((e) => e.id), [e1.id, e2.id, e3.id]);
});

const edgeMoves = [
  { name: "first entry up", pick: (ids) => ids[0], direction: "up" },
  { name: "last entry down", pick: (ids) => ids[ids.length - 1], direction: "down" },
  { name: "unknown id up", pick: () => "nope", direction: "up" },
  { name: "unknown id down", pick: () => "nope", direction: "down" },
];
for (const { name, pick, direction } of edgeMoves) {
  test(`move returns false and changes nothing: ${name} [surface: 'Returns false ... for an unknown id or a move past either end']`, () => {
    const store = new ContextBlockStore();
    const ids = [store.add(A()), store.add(B()), store.add(C())].map((e) => e.id);
    assert.strictEqual(store.move(pick(ids), direction), false);
    assert.deepStrictEqual(store.list().map((e) => e.id), ids, "order unchanged on a failed move");
  });
}

test("move on a single-entry store fails both ways", () => {
  const store = new ContextBlockStore();
  const e = store.add(A());
  assert.strictEqual(store.move(e.id, "up"), false);
  assert.strictEqual(store.move(e.id, "down"), false);
});

// ---- list order under combined mutation [surface: 'insertion order as mutated by move and remove']

test("list order = insertion order as mutated by move and remove", () => {
  const store = new ContextBlockStore();
  const a = store.add(A());
  const b = store.add(B());
  const c = store.add(C());
  const d = store.add(D());
  assert.strictEqual(store.remove(b.id), true); // [a, c, d]
  assert.strictEqual(store.move(d.id, "up"), true); // [a, d, c]
  assert.deepStrictEqual(store.list().map((e) => e.id), [a.id, d.id, c.id]);
});

// ---- toPromptBlocks [surface: 'a fresh array of fresh {uri, range, text} projections of list(), in list order']

test("toPromptBlocks projects exactly {uri, range, text} in list order; id and addedAtVersion never in the projection", () => {
  const store = new ContextBlockStore();
  store.add(A());
  store.add(B());
  const pb = store.toPromptBlocks();
  assert.strictEqual(pb.length, 2);
  for (const block of pb) {
    assert.deepStrictEqual(Object.keys(block).sort(), ["range", "text", "uri"], "nothing smuggled");
  }
  assert.deepStrictEqual(pb, [
    { uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "alpha text" },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 4 }, text: "beta text" },
  ]);
});

test("toPromptBlocks is computed at call time: it tracks mutations, and each call returns a fresh array [surface: 'computed at call time']", () => {
  const store = new ContextBlockStore();
  const a = store.add(A());
  const pb1 = store.toPromptBlocks();
  store.add(B());
  store.remove(a.id);
  const pb2 = store.toPromptBlocks();
  assert.notStrictEqual(pb1, pb2, "fresh array per call");
  assert.deepStrictEqual(pb1.map((b) => b.uri), ["file:///w/a.rs"], "earlier snapshot untouched");
  assert.deepStrictEqual(pb2.map((b) => b.uri), ["file:///w/b.rs"], "current call reflects current list");
});

test("mutating the returned array or its elements never affects the store [surface: toPromptBlocks bullet]", () => {
  const store = new ContextBlockStore();
  store.add(A());
  const pb = store.toPromptBlocks();
  pb.pop();
  const stolen = store.toPromptBlocks();
  stolen[0].text = "MUTATED";
  stolen[0].uri = "file:///evil.rs";
  stolen[0].range.startLine = 999;
  const clean = store.toPromptBlocks();
  assert.deepStrictEqual(clean, [
    { uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "alpha text" },
  ]);
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.list()[0].text, "alpha text");
});

// ---- entry immutability [surface: 'Entries are immutable records: the store never mutates an entry after add']

test("the store never mutates an entry after add: an entry reference is stable across later mutations", () => {
  const store = new ContextBlockStore();
  const e = store.add(A());
  const snapshot = JSON.parse(JSON.stringify(e));
  const b = store.add(B());
  store.move(b.id, "up");
  store.remove(b.id);
  store.toPromptBlocks();
  store.clear();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), snapshot, "entry unchanged even after clear removed it from the list");
});
