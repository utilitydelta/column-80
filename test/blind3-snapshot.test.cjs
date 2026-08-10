// Blind oracle: snapshot + staleness contract (phase3-surface.md
// "Snapshot semantics (the trust rule)" + "Staleness, the pure function").
// Written against the surface doc only; never read src/**. Expected red while
// stubs throw.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind3-snapshot",
  `export { sliceLines, isStale, ContextBlockStore } from "../src/core/contextBlocks";\n`
);
const { sliceLines, isStale, ContextBlockStore } = mod;
test.after(cleanup);

// ---- sliceLines [surface: 'sliceLines(text, range): the lines startLine..endLine (1-based, inclusive)']

const LF = "l1\nl2\nl3\nl4";
const sliceCases = [
  { name: "mid-range on LF text", text: LF, range: { startLine: 2, endLine: 3 }, expected: "l2\nl3" },
  { name: "single line", text: LF, range: { startLine: 2, endLine: 2 }, expected: "l2" },
  { name: "full range carries no trailing newline", text: LF, range: { startLine: 1, endLine: 4 }, expected: "l1\nl2\nl3\nl4" },
  { name: "endLine past the last line clamps", text: LF, range: { startLine: 3, endLine: 99 }, expected: "l3\nl4" },
  { name: "CRLF input: split on \\r\\n, output carries no \\r", text: "a\r\nb\r\nc", range: { startLine: 1, endLine: 2 }, expected: "a\nb" },
  { name: "mixed EOLs join with \\n", text: "a\nb\r\nc", range: { startLine: 1, endLine: 3 }, expected: "a\nb\nc" },
  { name: "startLine past the last line returns empty", text: LF, range: { startLine: 5, endLine: 9 }, expected: "" },
  { name: "startLine < 1 is malformed", text: LF, range: { startLine: 0, endLine: 2 }, expected: "" },
  { name: "endLine < startLine is malformed", text: LF, range: { startLine: 3, endLine: 2 }, expected: "" },
  { name: "non-integer startLine is malformed", text: LF, range: { startLine: 1.5, endLine: 2 }, expected: "" },
  { name: "non-integer endLine is malformed", text: LF, range: { startLine: 1, endLine: 2.5 }, expected: "" },
  { name: "NaN bound is malformed", text: LF, range: { startLine: NaN, endLine: 2 }, expected: "" },
  { name: "single-line text without newline", text: "only", range: { startLine: 1, endLine: 1 }, expected: "only" },
  { name: "empty text", text: "", range: { startLine: 1, endLine: 3 }, expected: "" },
];
for (const { name, text, range, expected } of sliceCases) {
  test(`sliceLines: ${name}`, () => {
    assert.strictEqual(sliceLines(text, range), expected);
  });
}

test("sliceLines never throws, whatever the range [surface: 'it never throws - staleness is display-only and a wrong flag beats a panic']", () => {
  const hostile = [
    { startLine: -5, endLine: -1 },
    { startLine: Infinity, endLine: Infinity },
    { startLine: 1, endLine: Number.MAX_SAFE_INTEGER },
    { startLine: NaN, endLine: NaN },
    { startLine: 9, endLine: 3 },
    { startLine: 0.1, endLine: 0.2 },
  ];
  for (const range of hostile) {
    assert.doesNotThrow(() => sliceLines(LF, range), `range ${JSON.stringify(range)}`);
  }
});

// ---- isStale [surface: 'isStale(entry, probe) is a conservative OR over whatever evidence the probe carries']

// A plain entry object: isStale is pure, no store needed.
const DOC = "l1\nl2\nl3\nl4";
const entry = (text = "l2\nl3", addedAtVersion = 7) => ({
  id: "b1",
  uri: "file:///w/a.rs",
  range: { startLine: 2, endLine: 3 },
  text,
  addedAtVersion,
});

const staleCases = [
  { name: "empty probe (document closed, nothing known) is not stale", e: entry(), probe: {}, expected: false },
  { name: "matching version alone is not stale", e: entry(), probe: { version: 7 }, expected: false },
  { name: "differing version alone is stale, even if the lines are untouched", e: entry(), probe: { version: 8 }, expected: true },
  { name: "version 0 still counts as differing", e: entry(), probe: { version: 0 }, expected: true },
  { name: "matching text alone is not stale", e: entry(), probe: { text: DOC }, expected: false },
  { name: "text edited inside the range is stale", e: entry(), probe: { text: "l1\nl2 CHANGED\nl3\nl4" }, expected: true },
  { name: "text edited outside the range is not stale on the text leg", e: entry(), probe: { text: "l1 CHANGED\nl2\nl3\nl4" }, expected: false },
  { name: "conservative OR: same version but changed text is stale", e: entry(), probe: { version: 7, text: "l1\nl2 CHANGED\nl3\nl4" }, expected: true },
  { name: "conservative OR: same text but changed version is stale", e: entry(), probe: { version: 9, text: DOC }, expected: true },
  { name: "both legs matching is not stale", e: entry(), probe: { version: 7, text: DOC }, expected: false },
  { name: "canonical: CRLF snapshot vs LF slice is not stale", e: entry("l2\r\nl3"), probe: { text: DOC }, expected: false },
  { name: "canonical: one trailing newline on the snapshot is stripped", e: entry("l2\nl3\n"), probe: { text: DOC }, expected: false },
  { name: "canonical strips at most one trailing newline: two is a real difference", e: entry("l2\nl3\n\n"), probe: { text: DOC }, expected: true },
  { name: "source shrank under the range: empty slice vs non-empty snapshot is stale", e: entry(), probe: { text: "l1" }, expected: true },
];
for (const { name, e, probe, expected } of staleCases) {
  test(`isStale: ${name}`, () => {
    assert.strictEqual(isStale(e, probe), expected);
  });
}

test("isStale is pure: same inputs same answer, entry and probe not mutated [surface: 'Pure: no I/O, no store access']", () => {
  const e = entry();
  const probe = { version: 9, text: DOC };
  const eBefore = JSON.parse(JSON.stringify(e));
  const probeBefore = JSON.parse(JSON.stringify(probe));
  const first = isStale(e, probe);
  const second = isStale(e, probe);
  assert.strictEqual(first, second);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)), eBefore, "entry untouched");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(probe)), probeBefore, "probe untouched");
});

// ---- frozen at add time [surface: 'Snapshot semantics (the trust rule)'; goal feature 3: '(uri, range, text) snapshots']

test("snapshot is frozen at add time: mutating the source input object after add never changes the block", () => {
  const store = new ContextBlockStore();
  const source = { uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "original text", version: 7 };
  const e = store.add(source);
  source.text = "MUTATED AFTER ADD";
  source.uri = "file:///evil.rs";
  source.range.startLine = 999;
  source.version = 42;
  assert.strictEqual(e.text, "original text");
  assert.strictEqual(e.uri, "file:///w/a.rs");
  assert.deepStrictEqual(e.range, { startLine: 2, endLine: 3 });
  assert.strictEqual(e.addedAtVersion, 7);
  assert.deepStrictEqual(store.toPromptBlocks(), [
    { uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "original text" },
  ]);
});

// ---- staleness is display-only [surface: 'A stale block still sends its frozen snapshot ...
// The only way a block stops reaching prompts is remove or clear. Editing the source is not removal.']

test("a stale block still reaches the projection with its frozen text; only remove stops it", () => {
  const store = new ContextBlockStore();
  const e = store.add({ uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "l2\nl3", version: 7 });
  const probe = { version: 8, text: "l1\nl2 CHANGED\nl3\nl4" };
  assert.strictEqual(isStale(e, probe), true, "control: the probe marks the block stale");
  assert.deepStrictEqual(
    store.toPromptBlocks(),
    [{ uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "l2\nl3" }],
    "stale block still included, frozen text, never refreshed"
  );
  assert.strictEqual(store.list()[0].text, "l2\nl3", "staleness never mutates the entry");
  store.remove(e.id);
  assert.deepStrictEqual(store.toPromptBlocks(), [], "remove is the only exit");
});
