// The pure usage-window cutter, white-box. Every bound here is a parameter the
// v29 experiments choose by measurement, so what this file pins is the
// mechanics: what gets skipped, what gets deduped, where a budget bites, and
// what the two render shapes look like.
//
// Run: SKIP_LIVE=1 node --test test/impl-v29-p2-usage-windows.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v29-p2-usage",
  `export { collectUsageWindows, renderUsageComment, renderUsageSection } from "../src/core/usageWindows";`,
);
test.after(cleanup);

const { collectUsageWindows, renderUsageComment, renderUsageSection } = mod;

const BOUNDS = { maxWindows: 3, linesBefore: 1, linesAfter: 1, maxChars: 4000 };

// One file, lines numbered so a window's identity is readable in a failure.
const FILE = [
  "fn setup() {",
  "    let grid = Grid::new(8);",
  "    grid.enroll(tile, LodBand::Regional);",
  "    grid.flush();",
  "}",
  "",
  "fn other() {",
  "    let g = Grid::new(2);",
  "    g.enroll(t, LodBand::Coastal);",
  "}",
];

const reader = (files) => (uri) => files[uri];

test("a window is the usage line plus its configured context, dedented", () => {
  const w = collectUsageWindows(
    [{ uri: "file:///a/src/setup.rs", line: 2 }],
    reader({ "file:///a/src/setup.rs": FILE }),
    BOUNDS,
  );
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].lines, [
    "let grid = Grid::new(8);",
    "grid.enroll(tile, LodBand::Regional);",
    "grid.flush();",
  ]);
  assert.equal(w[0].startLine, 1);
  assert.equal(w[0].endLine, 3);
});

// The site the human is completing at is not an example of itself, and a window
// spent on it is a window not spent on a real call.
test("the excluded site is skipped, and only that one", () => {
  const sites = [
    { uri: "file:///a/src/setup.rs", line: 2 },
    { uri: "file:///a/src/setup.rs", line: 8 },
  ];
  const w = collectUsageWindows(sites, reader({ "file:///a/src/setup.rs": FILE }), BOUNDS, {
    uri: "file:///a/src/setup.rs",
    line: 2,
  });
  assert.equal(w.length, 1);
  assert.ok(w[0].lines.join("\n").includes("LodBand::Coastal"));
});

// Two references inside one small function overlap, and the overlap is the same
// code twice.
test("a site already inside an emitted window is dropped, not merged", () => {
  const w = collectUsageWindows(
    [
      { uri: "file:///a/src/setup.rs", line: 2 },
      { uri: "file:///a/src/setup.rs", line: 3 },
    ],
    reader({ "file:///a/src/setup.rs": FILE }),
    BOUNDS,
  );
  assert.equal(w.length, 1, "the second reference sits inside the first window");
});

test("identical rendered text from two files is emitted once", () => {
  const same = ["", "    grid.enroll(tile);", ""];
  const w = collectUsageWindows(
    [
      { uri: "file:///a/one.rs", line: 1 },
      { uri: "file:///a/two.rs", line: 1 },
    ],
    reader({ "file:///a/one.rs": same, "file:///a/two.rs": same }),
    BOUNDS,
  );
  assert.equal(w.length, 1);
});

test("maxWindows caps the count", () => {
  const files = {};
  const sites = [];
  for (let i = 0; i < 10; i++) {
    files[`file:///a/f${i}.rs`] = [`call_${i}(x);`];
    sites.push({ uri: `file:///a/f${i}.rs`, line: 0 });
  }
  const w = collectUsageWindows(sites, reader(files), { ...BOUNDS, maxWindows: 4 });
  assert.equal(w.length, 4);
});

// Half a call is worse than no call: the model completes what it can see. And
// the windows BEHIND an oversized one still fit, so one long generated line at
// the head of the server's reference list must not zero the leg.
test("a window that would cross maxChars is dropped whole, and the ones behind it still fit", () => {
  const files = {
    "file:///a/small.rs": ["ok(1);"],
    "file:///a/big.rs": ["x".repeat(500)],
    "file:///a/after.rs": ["ok(2);"],
  };
  const w = collectUsageWindows(
    [
      { uri: "file:///a/small.rs", line: 0 },
      { uri: "file:///a/big.rs", line: 0 },
      { uri: "file:///a/after.rs", line: 0 },
    ],
    reader(files),
    { ...BOUNDS, maxChars: 100 },
  );
  assert.equal(w.length, 2);
  assert.deepEqual(w[0].lines, ["ok(1);"]);
  assert.deepEqual(w[1].lines, ["ok(2);"], "the small window after the oversized one still fits");
});

// The ceiling a caller passes is prompt room, and prompt room is what the
// RENDERED block costs. Charging only the raw source under-charges by a fifth,
// which is how the whole-block injector overran its own budget once.
test("the budget counts what the render costs, not what the source costs", () => {
  const files = {};
  const sites = [];
  for (let i = 0; i < 12; i++) {
    files[`file:///a/dir/f${i}.rs`] = [`call_${i}(x, y);`];
    sites.push({ uri: `file:///a/dir/f${i}.rs`, line: 0 });
  }
  const bounds = {
    maxWindows: 12,
    linesBefore: 0,
    linesAfter: 0,
    maxChars: 400,
    perLineChars: 3,
    perWindowChars: 20,
  };
  const w = collectUsageWindows(sites, reader(files), bounds);
  const rendered = renderUsageComment(w, "how it is called", "//");
  assert.ok(w.length > 0, "something must fit, or the row proves nothing");
  assert.ok(
    rendered.length <= bounds.maxChars,
    `rendered ${rendered.length} chars against a ${bounds.maxChars} budget`,
  );
});

// The header is caller text and the block is injected above the cursor, so a
// two-line header would otherwise put real code in the model's prefix.
test("a multi-line header is commented on every line", () => {
  const w = collectUsageWindows(
    [{ uri: "file:///a/x.rs", line: 0 }],
    reader({ "file:///a/x.rs": ["call();"] }),
    BOUNDS,
  );
  const text = renderUsageComment(w, "how it is called\nand where from", "//");
  for (const line of text.split("\n")) {
    assert.ok(line.startsWith("//"), `uncommented: ${JSON.stringify(line)}`);
  }
});

// A window two lines above a call site can hold a Rust doc example, and a naked
// triple backtick inside one closes the section early.
test("a window containing a fence does not close the section", () => {
  const file = ["/// ```", "/// let g = Grid::new(1);", "/// ```", "fn use_it() { g.enroll(t); }"];
  const w = collectUsageWindows(
    [{ uri: "file:///a/doc.rs", line: 3 }],
    reader({ "file:///a/doc.rs": file }),
    { ...BOUNDS, linesBefore: 3, linesAfter: 0 },
  );
  const text = renderUsageSection(w, "How this repo calls enroll");
  const lines = text.split("\n");
  const opener = lines.find((l) => /^`{3,}$/.test(l));
  assert.ok(opener, "a fence line exists");
  assert.ok(opener.length > 3, `the fence must outrun the body's own: ${opener}`);
  assert.equal(lines.filter((l) => l === opener).length, 2, "exactly one open and one close");
});

// A path with a space arrives percent-encoded, and a prompt naming a path that
// is not on the human's disk is worse than no provenance line.
test("a percent-encoded path is decoded in the provenance line", () => {
  const w = collectUsageWindows(
    [{ uri: "file:///a/my%20dir/x.rs", line: 0 }],
    reader({ "file:///a/my%20dir/x.rs": ["call();"] }),
    BOUNDS,
  );
  assert.ok(renderUsageComment(w, "h", "//").includes("my dir/x.rs"));
  assert.ok(renderUsageSection(w, "h").includes("my dir/x.rs"));
});

// An unreadable location should not cost the human every other window.
test("an unreadable file, an out-of-range line and a blank window are skipped, not thrown on", () => {
  const files = { "file:///a/blank.rs": ["", "   ", ""], "file:///a/real.rs": ["use_it();"] };
  const w = collectUsageWindows(
    [
      { uri: "file:///a/missing.rs", line: 0 },
      { uri: "file:///a/blank.rs", line: 1 },
      { uri: "file:///a/real.rs", line: 99 },
      { uri: "file:///a/real.rs", line: -1 },
      { uri: "file:///a/real.rs", line: 0 },
    ],
    reader(files),
    BOUNDS,
  );
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].lines, ["use_it();"]);
});

test("no sites is no windows and no render", () => {
  const w = collectUsageWindows([], reader({}), BOUNDS);
  assert.deepEqual(w, []);
  assert.equal(renderUsageComment(w, "how it is called", "//"), undefined);
  assert.equal(renderUsageSection(w, "how it is called"), undefined);
});

// The FIM shape: everything is a comment, or the model continues it as code.
test("the comment render leaves no uncommented line, and uses the language's own opener", () => {
  const w = collectUsageWindows(
    [{ uri: "file:///a/src/setup.py", line: 1 }],
    reader({ "file:///a/src/setup.py": ["x = 1", "", "grid.enroll(t)"] }),
    { ...BOUNDS, linesBefore: 1, linesAfter: 1 },
  );
  const text = renderUsageComment(w, "how enroll is called here", "#");
  for (const line of text.split("\n")) {
    assert.ok(line.startsWith("#"), `uncommented line in a FIM block: ${JSON.stringify(line)}`);
  }
  assert.ok(text.includes("src/setup.py:1"), "the window names where it came from");
});

test("the section render fences each window and names its line range", () => {
  const w = collectUsageWindows(
    [{ uri: "file:///a/src/setup.rs", line: 2 }],
    reader({ "file:///a/src/setup.rs": FILE }),
    BOUNDS,
  );
  const text = renderUsageSection(w, "How this repo calls enroll");
  assert.ok(text.startsWith("How this repo calls enroll\n"));
  assert.ok(text.includes("src/setup.rs#L2-L4"));
  assert.equal(text.split("```").length - 1, 2, "one open and one close fence");
});
