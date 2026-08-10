// contextAddFile widened to the tree and the tab (session-v32 phase 4, goal
// item 5), driving the REAL registered command over a fake vscode module.
//
// The red test written FIRST is target-disagrees-with-active-editor: before this
// phase the command read `activeEditor()` and ignored its arguments entirely, so
// an explorer click silently added the wrong file whenever the tree selection
// and the active editor disagreed. That is the whole defect, and the tab surface
// is a second door into it, because right-clicking a tab does not activate it.
//
// The other axis is ARGUMENT SHAPE. Five surfaces reach this command and they do
// not agree about what they pass, so it decides on TYPE, never on presence. Each
// shape any of them can produce gets a row, junk first argument included.
//
// Run: SKIP_LIVE=1 node --test test/impl-v32-p4-addfile.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub, makeDoc } = require("./.vscode-stub.cjs");

const { mod: surf, vscode, cleanup, error: surfErr } = bundleWithVscodeStub(
  "impl-v32-p4-addfile",
  [
    `export { registerContextPanel } from "../src/vscode/contextPanel";`,
    `export { ContextBlockStore } from "../src/core/contextBlocks";`,
    `export { looksBinary } from "../src/core/contextGestures";`,
    "",
  ].join("\n"),
);
test.after(cleanup);

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (surfErr) return ctx.skip(`surface bundle failed to build: ${surfErr.message}`);
    return fn(ctx);
  });

test("bundle guard: contextPanel builds headless against the vscode stub", () => {
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

// A world of documents keyed by uri, one of which may be the active editor.
function world({ files, active }) {
  const docs = {};
  for (const [name, text] of Object.entries(files)) {
    const uriStr = `file:///w/${name}`;
    docs[uriStr] = makeDoc(vscode, text, uriStr, guessLang(name), 7);
  }
  globalThis.__C80_DOCS__ = docs;
  globalThis.__C80_OPEN_DOCS__ = Object.values(docs);
  globalThis.__C80_ACTIVE__ = active
    ? { document: docs[`file:///w/${active}`], selections: [], setDecorations() {} }
    : undefined;
  globalThis.__C80_VISIBLE__ = active ? [globalThis.__C80_ACTIVE__] : [];
  globalThis.__C80_WARNINGS__ = [];
  globalThis.__C80_COMMANDS__ = {};
  globalThis.__C80_SYMBOLS__ = {};
  globalThis.__C80_CHAINS__ = {};

  const store = new surf.ContextBlockStore();
  surf.registerContextPanel({ subscriptions: [] }, store);
  return {
    store,
    uri: (name) => vscode.Uri.parse(`file:///w/${name}`),
    run: (...args) => globalThis.__C80_COMMANDS__["column80.contextAddFile"](...args),
    added: () => store.list().map((e) => e.uri.replace("file:///w/", "")),
    warnings: () => globalThis.__C80_WARNINGS__,
  };
}

function guessLang(name) {
  if (name.endsWith(".ts")) return "typescript";
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".yaml")) return "yaml";
  if (name.endsWith(".log")) return "log";
  return "plaintext";
}

const SRC = 'export const total = 1;\nexport const band = 2;\n';

// ===========================================================================
// The red test, first.
// ===========================================================================

gtest("RED FIRST: a uri argument wins over the active editor, which is the whole defect", async () => {
  const w = world({ files: { "clicked.ts": SRC, "active.ts": SRC }, active: "active.ts" });
  await w.run(w.uri("clicked.ts"));
  assert.deepStrictEqual(w.added(), ["clicked.ts"], "the tree click, not whatever happened to be focused");
});

gtest("RED FIRST, second door: the same disagreement through a right-clicked TAB", async () => {
  // Right-clicking a tab does not activate it, so the tab the human aimed at and
  // the active editor routinely disagree. Same bug, one more surface.
  const w = world({ files: { "tab.ts": SRC, "active.ts": SRC }, active: "active.ts" });
  await w.run(w.uri("tab.ts"));
  assert.deepStrictEqual(w.added(), ["tab.ts"]);
});

// ===========================================================================
// Argument shapes: one row per shape the five surfaces can produce.
// ===========================================================================

gtest("arg 2 carries the FULL multi-selection, and arg 1 alone would add one of six", async () => {
  const files = {};
  for (let i = 1; i <= 6; i++) files[`f${i}.ts`] = SRC;
  const w = world({ files, active: "f1.ts" });
  const selection = [1, 2, 3, 4, 5, 6].map((i) => w.uri(`f${i}.ts`));
  // Arg 1 is only the file the human right-clicked ON, here the third.
  await w.run(w.uri("f3.ts"), selection);
  assert.deepStrictEqual(w.added(), ["f1.ts", "f2.ts", "f3.ts", "f4.ts", "f5.ts", "f6.ts"]);
});

gtest("order comes from the tree, not from click history", async () => {
  const w = world({ files: { "a.ts": SRC, "b.ts": SRC, "c.ts": SRC }, active: "a.ts" });
  // Ctrl-clicked bottom to top. VS Code hands the selection back in TREE order,
  // and the panel must read that order, matching the multi-cursor rule.
  await w.run(w.uri("c.ts"), [w.uri("a.ts"), w.uri("b.ts"), w.uri("c.ts")]);
  assert.deepStrictEqual(w.added(), ["a.ts", "b.ts", "c.ts"]);
});

gtest("both args absent is the palette path, and it still means the active editor", async () => {
  const w = world({ files: { "active.ts": SRC, "other.ts": SRC }, active: "active.ts" });
  await w.run();
  assert.deepStrictEqual(w.added(), ["active.ts"]);
});

gtest("a junk first argument falls back to the active editor instead of crashing", async () => {
  // The panel's own view/title button and the tab surface pass UNVERIFIED
  // shapes. Deciding on TYPE rather than presence is what makes a wrong guess a
  // fallback instead of a TypeError or the wrong file.
  for (const junk of ["file:///w/other.ts", 42, null, {}, { fsPath: "/w/other.ts" }, [], true]) {
    const w = world({ files: { "active.ts": SRC, "other.ts": SRC }, active: "active.ts" });
    await w.run(junk);
    assert.deepStrictEqual(w.added(), ["active.ts"], `junk arg1: ${JSON.stringify(junk)}`);
  }
});

gtest("a junk second argument, or an array of junk, falls back the same way", async () => {
  for (const junk of ["not an array", 0, {}, [1, 2, 3], ["file:///w/other.ts"], [null]]) {
    const w = world({ files: { "active.ts": SRC, "other.ts": SRC }, active: "active.ts" });
    await w.run(undefined, junk);
    assert.deepStrictEqual(w.added(), ["active.ts"], `junk arg2: ${JSON.stringify(junk)}`);
  }
});

gtest("an array MIXING uris and junk keeps only the uris", async () => {
  const w = world({ files: { "a.ts": SRC, "b.ts": SRC, "active.ts": SRC }, active: "active.ts" });
  await w.run(w.uri("a.ts"), [w.uri("a.ts"), "junk", 7, w.uri("b.ts"), null]);
  assert.deepStrictEqual(w.added(), ["a.ts", "b.ts"]);
});

gtest("the same uri twice is one panel entry", async () => {
  const w = world({ files: { "a.ts": SRC }, active: "a.ts" });
  await w.run(w.uri("a.ts"), [w.uri("a.ts"), w.uri("a.ts"), w.uri("a.ts")]);
  assert.deepStrictEqual(w.added(), ["a.ts"]);
});

gtest("no args and no active editor refuses once and adds nothing", async () => {
  const w = world({ files: { "a.ts": SRC }, active: undefined });
  await w.run();
  assert.deepStrictEqual(w.added(), []);
  assert.strictEqual(w.warnings().length, 1);
});

// ===========================================================================
// Per-file refusals: never all-or-nothing.
// ===========================================================================

gtest("one EMPTY file in a selection of three adds the other two and names the empty one", async () => {
  const w = world({ files: { "a.ts": SRC, "empty.ts": "", "c.ts": SRC }, active: "a.ts" });
  await w.run(w.uri("a.ts"), [w.uri("a.ts"), w.uri("empty.ts"), w.uri("c.ts")]);
  assert.deepStrictEqual(w.added(), ["a.ts", "c.ts"]);
  assert.strictEqual(w.warnings().length, 1);
  assert.match(w.warnings()[0], /empty\.ts is empty/);
});

gtest("one UNREADABLE file adds the other two and names the failure", async () => {
  const w = world({ files: { "a.ts": SRC, "c.ts": SRC }, active: "a.ts" });
  // gone.ts is not in the world, so openTextDocument throws.
  await w.run(w.uri("a.ts"), [w.uri("a.ts"), w.uri("gone.ts"), w.uri("c.ts")]);
  assert.deepStrictEqual(w.added(), ["a.ts", "c.ts"]);
  assert.strictEqual(w.warnings().length, 1);
  assert.match(w.warnings()[0], /cannot read gone\.ts/);
});

gtest("one BINARY file adds the other two and names it, never a block of mojibake", async () => {
  const binary = `PK    ${" ".repeat(40)}`;
  const w = world({ files: { "a.ts": SRC, "blob.bin": binary, "c.ts": SRC }, active: "a.ts" });
  await w.run(w.uri("a.ts"), [w.uri("a.ts"), w.uri("blob.bin"), w.uri("c.ts")]);
  assert.deepStrictEqual(w.added(), ["a.ts", "c.ts"]);
  assert.match(w.warnings()[0], /blob\.bin is not text/);
});

gtest("a file no editor has open is added with the version the document reports", async () => {
  const w = world({ files: { "closed.ts": SRC, "active.ts": SRC }, active: "active.ts" });
  await w.run(w.uri("closed.ts"));
  const entry = w.store.list()[0];
  assert.strictEqual(entry.uri, "file:///w/closed.ts");
  assert.strictEqual(entry.addedAtVersion, 7, "the probe stays honest for a closed file");
  assert.strictEqual(entry.text, SRC);
  assert.deepStrictEqual({ ...entry.range }, { startLine: 1, endLine: 3 });
});

gtest("markdown, json, yaml and a log all add exactly like source (decision 5)", async () => {
  const w = world({
    files: {
      "notes.md": "# Notes\n\nThe design.\n",
      "conf.json": '{ "a": 1 }\n',
      "ci.yaml": "steps:\n  - run: test\n",
      "run.log": "started\nfinished\n",
      "active.ts": SRC,
    },
    active: "active.ts",
  });
  const names = ["notes.md", "conf.json", "ci.yaml", "run.log"];
  await w.run(w.uri("notes.md"), names.map((n) => w.uri(n)));
  assert.deepStrictEqual(w.added(), names, "unsupported languages are often the whole point");
  assert.strictEqual(w.warnings().length, 0);
});

gtest("a large file is added rather than refused, because truncation is banned", async () => {
  // The snapshot the human saw must be the snapshot the model gets, so there is
  // no threshold to guess. The store logs the byte count; the prompt budget
  // refuses loudly downstream if it must.
  const big = "export const x = 1;\n".repeat(20000);
  const w = world({ files: { "big.ts": big }, active: "big.ts" });
  await w.run(w.uri("big.ts"));
  assert.deepStrictEqual(w.added(), ["big.ts"]);
  assert.strictEqual(w.store.list()[0].text, big, "verbatim, not truncated");
});

// ===========================================================================
// looksBinary, the only content-shaped refusal on this path.
// ===========================================================================

gtest("looksBinary: a NUL anywhere in the first page is the whole cheap test", () => {
  assert.strictEqual(surf.looksBinary("plain text more"), true);
  assert.strictEqual(surf.looksBinary(`${"a".repeat(4000)} `), true, "inside the sniff window");
  assert.strictEqual(surf.looksBinary(`${"a".repeat(9000)} `), false, "past it, deliberately unread");
});

gtest("looksBinary: a FIELD of replacement characters is mojibake; one or two are not", () => {
  assert.strictEqual(surf.looksBinary("�".repeat(50)), true);
  assert.strictEqual(surf.looksBinary("a legitimate � in prose"), false);
  assert.strictEqual(surf.looksBinary("���"), false, "under the floor of four");
  // Four replacements in a long file is under the fraction, so still text.
  assert.strictEqual(surf.looksBinary(`${"a".repeat(2000)}����`), false);
});

gtest("looksBinary: empty text is NOT binary, because empty has its own refusal", () => {
  assert.strictEqual(surf.looksBinary(""), false);
});

gtest("looksBinary: real source in five languages is never binary", () => {
  const sources = [
    "pub fn total() -> u32 {\n    0\n}\n",
    "export function total(): number {\n  return 0;\n}\n",
    "public int Total() => 0;\n",
    "func total() uint32 {\n\treturn 0\n}\n",
    "def total() -> int:\n    return 0\n",
    "# A markdown file\n\nWith **prose** and a `code` span.\n",
    '{ "nested": { "utf8": "café naïve 中文 🚀" } }\n',
  ];
  for (const source of sources) {
    assert.strictEqual(surf.looksBinary(source), false, JSON.stringify(source.slice(0, 24)));
  }
});
