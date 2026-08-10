// The usage leg's budget and its dark reasons. What it renders is
// `usageWindows`'s (pinned in impl-v29-p2-usage-windows); what this file pins is
// the part that decides whether the leg runs at all, which is the part that
// keeps it off the keystroke path when the answer would arrive too late.
//
// Run: SKIP_LIVE=1 node --test test/impl-v29-p3-usage-surface.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v29-p3-usage",
  `export { resolveUsageInBudget, USAGE_MIN_BUDGET_MS, USAGE_WINDOW_BOUNDS } from "../src/core/usageSurface";`,
);
test.after(cleanup);

const { resolveUsageInBudget, USAGE_MIN_BUDGET_MS, USAGE_WINDOW_BOUNDS } = mod;

const CURSOR = { uri: "file:///w/src/site.rs", line: 10, character: 14 };

const FILES = {
  "file:///w/src/a.rs": ["fn setup() {", "    grid.enroll(tile, band);", "}"],
  "file:///w/src/b.rs": ["fn other() {", "    g.enroll(t, LodBand::Coastal);", "}"],
};
const readLines = (uri) => FILES[uri];

function extractorWith(references, delayMs = 0) {
  return {
    references: async () =>
      new Promise((resolve) => setTimeout(() => resolve(references), delayMs)),
  };
}

test("a member with call sites gets a block naming them", async () => {
  const r = await resolveUsageInBudget(
    extractorWith([
      { uri: "file:///w/src/a.rs", line: 1, character: 9, endLine: 1, endCharacter: 15 },
      { uri: "file:///w/src/b.rs", line: 1, character: 6, endLine: 1, endCharacter: 12 },
    ]),
    CURSOR,
    "enroll",
    "//",
    readLines,
    200,
  );
  assert.equal(r.windows, 2);
  assert.equal(r.references, 2);
  assert.ok(r.block.includes("how enroll is called in this repo"));
  for (const line of r.block.split("\n")) {
    assert.ok(line.startsWith("//"), `uncommented line reaches the FIM prefix: ${line}`);
  }
});

// The whole point of the budget: a leg that loses the race must cost the
// signature block nothing, and must not be waited on.
test("a slow reference query is abandoned, with the reason", async () => {
  const started = Date.now();
  const r = await resolveUsageInBudget(
    extractorWith([{ uri: "file:///w/src/a.rs", line: 1, character: 9, endLine: 1, endCharacter: 15 }], 400),
    CURSOR,
    "enroll",
    "//",
    readLines,
    40,
  );
  const spent = Date.now() - started;
  assert.equal(r.block, undefined);
  assert.match(r.reason, /did not answer inside the injection window/);
  assert.ok(spent < 200, `the caller waited ${spent}ms on a 40ms budget`);
});

test("a budget too small to be worth starting does not start", async () => {
  let asked = 0;
  const r = await resolveUsageInBudget(
    { references: async () => { asked += 1; return []; } },
    CURSOR,
    "enroll",
    "//",
    readLines,
    USAGE_MIN_BUDGET_MS - 1,
  );
  assert.equal(asked, 0, "a query begun with no window left is a query answered too late");
  assert.match(r.reason, /of the injection window was left/);
});

// A first use, or a member only called from another project. The honest answer
// is the control arm, said once, never something adjacent.
test("a member with no references anywhere says so and injects nothing", async () => {
  const r = await resolveUsageInBudget(extractorWith([]), CURSOR, "enroll", "//", readLines, 200);
  assert.equal(r.block, undefined);
  assert.match(r.reason, /no other call site/);
});

test("a language whose extractor has no reference leg is dark, not broken", async () => {
  const r = await resolveUsageInBudget({}, CURSOR, "enroll", "//", readLines, 200);
  assert.equal(r.block, undefined);
  assert.match(r.reason, /no reference leg/);
});

// The cursor's own line is not an example of itself, and a window spent on it is
// a window not spent on a real call.
test("the only reference being the cursor's own line yields no block", async () => {
  const r = await resolveUsageInBudget(
    extractorWith([{ uri: CURSOR.uri, line: CURSOR.line, character: 4, endLine: CURSOR.line, endCharacter: 10 }]),
    CURSOR,
    "enroll",
    "//",
    (uri) => (uri === CURSOR.uri ? ["x", "y"] : FILES[uri]),
    200,
  );
  assert.equal(r.block, undefined);
  assert.equal(r.references, 1);
  assert.match(r.reason, /cursor's own line or unreadable/);
});

test("the language's own comment opener is used, not a hardcoded slash", async () => {
  const r = await resolveUsageInBudget(
    extractorWith([{ uri: "file:///w/src/a.rs", line: 1, character: 9, endLine: 1, endCharacter: 15 }]),
    { ...CURSOR, uri: "file:///w/src/site.py" },
    "enroll",
    "#",
    readLines,
    200,
  );
  for (const line of r.block.split("\n")) {
    assert.ok(line.startsWith("#"), line);
  }
});

// The shipped bounds are the values the arms ran at. A change to them is a
// change to what was measured, and should have to say so here first.
test("the shipped bounds are the measured ones", () => {
  assert.deepEqual(USAGE_WINDOW_BOUNDS, {
    maxWindows: 3,
    linesBefore: 1,
    linesAfter: 1,
    maxChars: 900,
  });
});
