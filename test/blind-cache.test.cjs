// Blind oracle: CompletionCache contract (phase1-surface.md "src/core/cache.ts").
// Written against the surface doc only; never read src/**. Expected red while
// step-A stubs throw "unimplemented".
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-cache",
  `export { CompletionCache } from "../src/core/cache";\n`
);
const { CompletionCache } = mod;
test.after(cleanup);

// Distinct-head prefixes so LRU tests can never cross-hit via prefix-walk.
const S = "\n// suffix\n";

test("exact hit: get returns the completion stored under exactly (prefix, suffix) [surface: cache 'get semantics' 1]", () => {
  const c = new CompletionCache(10);
  c.set("aa;\n", S, "one()");
  assert.strictEqual(c.get("aa;\n", S), "one()");
  assert.strictEqual(c.size, 1);
});

test("keying: a different suffix or unrelated prefix misses [surface: cache 'keyed on the exact (prefix, suffix) pair']", () => {
  const c = new CompletionCache(10);
  c.set("aa;\n", S, "one()");
  assert.strictEqual(c.get("aa;\n", "\n// other\n"), undefined, "suffix must match exactly");
  assert.strictEqual(c.get("zz;\n", S), undefined, "unrelated prefix misses");
});

test("LRU eviction: inserting past capacity evicts the least recently used entry [surface: cache 'at most capacity entries']", () => {
  const c = new CompletionCache(3);
  c.set("aa;\n", S, "1");
  c.set("bb;\n", S, "2");
  c.set("cc;\n", S, "3");
  // Refresh aa via get, then insert a fourth: bb is now LRU and must go.
  assert.strictEqual(c.get("aa;\n", S), "1");
  c.set("dd;\n", S, "4");
  assert.strictEqual(c.size, 3);
  assert.strictEqual(c.get("bb;\n", S), undefined, "LRU entry evicted");
  assert.strictEqual(c.get("aa;\n", S), "1", "get counted as use");
  assert.strictEqual(c.get("cc;\n", S), "3");
  assert.strictEqual(c.get("dd;\n", S), "4");
});

test("recency: set counts as use, so a re-set entry survives the next eviction [surface: cache 'both get hits and set count as use']", () => {
  const c = new CompletionCache(2);
  c.set("aa;\n", S, "1");
  c.set("bb;\n", S, "2");
  c.set("aa;\n", S, "1b"); // refresh aa; bb becomes LRU
  c.set("cc;\n", S, "3");
  assert.strictEqual(c.get("bb;\n", S), undefined, "bb evicted, not aa");
  assert.strictEqual(c.get("aa;\n", S), "1b");
  assert.strictEqual(c.get("cc;\n", S), "3");
});

test("size and clear: size tracks entries, caps at capacity, clear empties [surface: cache 'size is the current entry count']", () => {
  const c = new CompletionCache(2);
  assert.strictEqual(c.size, 0);
  c.set("aa;\n", S, "1");
  assert.strictEqual(c.size, 1);
  c.set("bb;\n", S, "2");
  c.set("cc;\n", S, "3");
  assert.strictEqual(c.size, 2, "size never exceeds capacity");
  c.clear();
  assert.strictEqual(c.size, 0);
  assert.strictEqual(c.get("cc;\n", S), undefined);
});

// Prefix-walking: typing through a suggestion keeps hitting the cache.
// [surface: cache 'get semantics' 2 and 'Prefix-walk boundaries']
const WALK_PREFIX = "const x = 1;\n";
const WALK_COMPLETION = "function greet() { return 1; }";

for (const typedLen of [1, 8, WALK_COMPLETION.length - 1]) {
  test(`prefix-walk hit: typed ${typedLen} chars of the suggestion returns the remainder [surface: cache 'get semantics' 2]`, () => {
    const c = new CompletionCache(10);
    c.set(WALK_PREFIX, S, WALK_COMPLETION);
    const typed = WALK_COMPLETION.slice(0, typedLen);
    assert.strictEqual(
      c.get(WALK_PREFIX + typed, S),
      WALK_COMPLETION.slice(typedLen)
    );
  });
}

test("prefix-walk boundary: typed equal to the full completion is not a hit [surface: 'typed equal to the full completion is not a hit']", () => {
  const c = new CompletionCache(10);
  c.set(WALK_PREFIX, S, WALK_COMPLETION);
  assert.strictEqual(c.get(WALK_PREFIX + WALK_COMPLETION, S), undefined);
});

test("prefix-walk boundary: the suffix must match exactly [surface: 'the suffix must match exactly']", () => {
  const c = new CompletionCache(10);
  c.set(WALK_PREFIX, S, WALK_COMPLETION);
  assert.strictEqual(c.get(WALK_PREFIX + "function", "\n// other\n"), undefined);
});

test("prefix-walk boundary: typed must be a strict prefix of the completion [surface: 'typed ... is a strict prefix of that entry's completion']", () => {
  const c = new CompletionCache(10);
  c.set(WALK_PREFIX, S, WALK_COMPLETION);
  assert.strictEqual(c.get(WALK_PREFIX + "xyz", S), undefined);
});

test("prefix-walk window: typed of exactly 50 chars is still considered [surface: 'at most the last 50 characters of prefix as candidate typed values']", () => {
  const c = new CompletionCache(10);
  const completion = "abcdefghij".repeat(6); // 60 chars
  c.set(WALK_PREFIX, S, completion);
  const typed = completion.slice(0, 50);
  assert.strictEqual(c.get(WALK_PREFIX + typed, S), completion.slice(50));
  // Beyond 50 the surface says "may miss, which is acceptable": not asserted.
});

test("prefix-walk hit does not insert a new entry [surface: 'A prefix-walk hit does not insert a new entry']", () => {
  const c = new CompletionCache(10);
  c.set(WALK_PREFIX, S, WALK_COMPLETION);
  c.get(WALK_PREFIX + "function", S);
  assert.strictEqual(c.size, 1);
});

test("exact hit wins over prefix-walk when both apply [surface: 'get semantics, in order']", () => {
  const c = new CompletionCache(10);
  c.set(WALK_PREFIX, S, WALK_COMPLETION);
  // Also store an exact entry at the walked position with a different completion.
  c.set(WALK_PREFIX + "function", S, "DIFFERENT()");
  assert.strictEqual(c.get(WALK_PREFIX + "function", S), "DIFFERENT()");
});
