// Implementer oracle: CompletionCache edges beyond the blind contract set —
// capacity extremes, the 50-char walk window's far side, walk/recency
// interaction. Complements test/blind-cache.test.cjs.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-cache",
  `export { CompletionCache } from "../src/core/cache";\n`
);
const { CompletionCache } = mod;
test.after(cleanup);

const S = "\n// suffix\n";

test("capacity 1: every insert evicts the previous entry", () => {
  const c = new CompletionCache(1);
  c.set("aa", S, "1");
  c.set("bb", S, "2");
  assert.strictEqual(c.size, 1);
  assert.strictEqual(c.get("aa", S), undefined);
  assert.strictEqual(c.get("bb", S), "2");
});

test("re-set of an existing key overwrites without growing size", () => {
  const c = new CompletionCache(5);
  c.set("aa", S, "old");
  c.set("aa", S, "new");
  assert.strictEqual(c.size, 1);
  assert.strictEqual(c.get("aa", S), "new");
});

test("prefix-walk window far side: 51 typed chars is a miss", () => {
  const c = new CompletionCache(5);
  const completion = "abcdefghij".repeat(6); // 60 chars
  c.set("base:", S, completion);
  assert.strictEqual(c.get("base:" + completion.slice(0, 51), S), undefined);
});

test("prefix-walk hit counts as use for the walked entry's recency", () => {
  const c = new CompletionCache(2);
  c.set("aa", S, "walkable()");
  c.set("bb", S, "2");
  // Walk-hit aa: it becomes most recent, so inserting cc evicts bb.
  assert.strictEqual(c.get("aa" + "walk", S), "able()");
  c.set("cc", S, "3");
  assert.strictEqual(c.get("bb", S), undefined, "bb evicted");
  assert.strictEqual(c.get("aa", S), "walkable()", "walked entry survived");
});

test("prefix-walk with empty stored prefix: typed text alone walks", () => {
  const c = new CompletionCache(5);
  c.set("", S, "hello world");
  assert.strictEqual(c.get("hello", S), " world");
});

test("walk prefers the shortest typed candidate when several entries could match", () => {
  const c = new CompletionCache(5);
  // Entry A at "x", completion "yz..."; entry B at "xy", completion "z...".
  // Cursor at "xyz": typed "z" against B (len 1) wins over typed "yz" against A.
  c.set("x", S, "yzAAA");
  c.set("xy", S, "zBBB");
  assert.strictEqual(c.get("xyz", S), "BBB");
});

test("clear resets walk hits too", () => {
  const c = new CompletionCache(5);
  c.set("aa", S, "typing()");
  c.clear();
  assert.strictEqual(c.get("aatyp", S), undefined);
});

test("suffix is part of the identity for walk hits even when prefixes align", () => {
  const c = new CompletionCache(5);
  c.set("aa", "\n// one\n", "typing()");
  c.set("aa", "\n// two\n", "other()");
  assert.strictEqual(c.get("aatyp", "\n// one\n"), "ing()");
  assert.strictEqual(c.get("aaoth", "\n// two\n"), "er()");
  assert.strictEqual(c.get("aatyp", "\n// two\n"), undefined);
});
