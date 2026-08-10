// The vscode WIRING of live context blocks: the three workspace subscriptions
// the panel added (close, rename, delete) and the generate-time lost-block
// warning, driven headless.
//
// No other test in the repo drives those subscriptions, which is how three
// defects lived in them. The harness is what makes them reachable: the vscode
// stub RECORDS every event handler the extension registers instead of dropping
// it on the floor, so a test can fire an event the way the extension host does.
//
// Two harnesses:
//  A. registerContextPanel over the recording stub, for the event handlers.
//  B. registerFnGen over the same stub, driving the manual repair command so
//     its oracle ctx can be asked for context blocks the way oracleSurface's
//     `while (action.kind === "repair")` loop asks: once per ROUND.
//
// Run: SKIP_LIVE=1 node --test test/impl-v33-p3-wiring.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v33-p3-wiring-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], commands: {}, activeTextEditor: undefined,
  terminals: [], warnResponses: [], textDocuments: [], visibleTextEditors: [],
  onClose: [], onRename: [], onDelete: [], onChange: [], docs: {}, executed: [],
  // A command the extension host refuses. The view's own focus command is
  // contributed by VS Code rather than by us, so a renamed or unregistered view
  // makes executeCommand REJECT while the toast's handler runs unawaited.
  executeThrows: null,
};
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  contains(pos) {
    const afterStart = pos.line > this.start.line || (pos.line === this.start.line && pos.character >= this.start.character);
    const beforeEnd = pos.line < this.end.line || (pos.line === this.end.line && pos.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class Selection extends Range {}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class ThemeIcon { constructor(id, color) { this.id = id; this.color = color; } }
class TreeItem { constructor(label, state) { this.label = label; this.collapsibleState = state; } }
class MarkdownString { appendCodeblock() {} }
class Diagnostic { constructor(range, message) { this.range = range; this.message = message; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (v) => {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(\\/\\/[^/?#]*)?([^?#]*)/.exec(v);
    if (!m) { throw new Error("[UriError]: cannot parse " + v); }
    return { scheme: m[1], path: m[3] || "", fsPath: m[3] || "", toString: () => v };
  },
};
const SYMBOLS = [{
  name: "broken", kind: 11,
  range: new Range(0, 0, 2, 1), selectionRange: new Range(0, 3, 0, 9), children: [],
}];
const disposable = () => ({ dispose() {} });
module.exports = {
  __state: state,
  Position, Range, Selection, EventEmitter, ThemeColor, ThemeIcon, TreeItem, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  SymbolKind: { Function: 11, Method: 5, Constructor: 8, Struct: 22, Enum: 9 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined, update: async () => {},
    }),
    onDidChangeConfiguration: () => disposable(),
    registerTextDocumentContentProvider: () => disposable(),
    onDidChangeTextDocument: (fn) => { state.onChange.push(fn); return disposable(); },
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: (fn) => { state.onClose.push(fn); return disposable(); },
    onDidRenameFiles: (fn) => { state.onRename.push(fn); return disposable(); },
    onDidDeleteFiles: (fn) => { state.onDelete.push(fn); return disposable(); },
    onDidSaveTextDocument: () => disposable(),
    get textDocuments() { return state.textDocuments; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      if (state.docs[key]) { return state.docs[key]; }
      throw new Error("cannot open " + key);
    },
    applyEdit: async () => true,
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, show() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    registerTreeDataProvider: () => disposable(),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    showWarningMessage: async (message, ...actions) => {
      state.messages.push({ kind: "warn", message, actions });
      const queued = (state.warnResponses || []).shift();
      // A FUNCTION response is how a test models the human doing something else
      // while the toast is on screen and only then clicking a button.
      return typeof queued === "function" ? queued() : queued;
    },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    showTextDocument: async (d) => ({ document: d, selection: undefined, revealRange() {} }),
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => disposable() }),
    setStatusBarMessage: () => disposable(),
    onDidChangeVisibleTextEditors: () => disposable(),
    createTerminal: (opts) => {
      const t = { name: opts.name, shown: false, sent: [], show() { this.shown = true; }, sendText(s) { this.sent.push(s); } };
      state.terminals.push(t);
      return t;
    },
    get terminals() { return state.terminals; },
    tabGroups: { all: [], onDidChangeTabs: () => disposable(), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return disposable(); },
    executeCommand: async (id) => {
      state.executed.push(id);
      if (state.executeThrows) { throw new Error(state.executeThrows); }
      return id === "vscode.executeDocumentSymbolProvider" ? SYMBOLS : undefined;
    },
  },
};
`,
);

const entry = path.join(__dirname, ".impl-v33-p3-wiring.entry.ts");
const outfile = path.join(__dirname, ".impl-v33-p3-wiring.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { registerFnGen } from "../src/vscode/fnGen";
export { registerContextPanel, ContextBlockTreeProvider, fileLabel } from "../src/vscode/contextPanel";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const {
  registerFnGen,
  registerContextPanel,
  ContextBlockTreeProvider,
  fileLabel,
  ContextBlockStore,
  __state,
} = require(outfile);

test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const reset = () => {
  __state.config = { repairEnabled: true, compilerDirectedInjection: false };
  __state.messages = [];
  __state.commands = {};
  __state.terminals = [];
  __state.textDocuments = [];
  __state.visibleTextEditors = [];
  __state.docs = {};
  __state.onClose = [];
  __state.onRename = [];
  __state.onDelete = [];
  __state.onChange = [];
  __state.executed = [];
  __state.executeThrows = null;
  // The queue showWarningMessage answers from, one shift per toast: it is how a
  // headless test says "the human clicked Remove".
  __state.warnResponses = [];
};

const uriOf = (s) => ({ toString: () => s, path: s.replace(/^file:\/\//, ""), scheme: "file", fsPath: s.replace(/^file:\/\//, "") });

// ---------------------------------------------------------------------------
// Harness A: the panel's event subscriptions, driven directly.
// ---------------------------------------------------------------------------
const panelWith = (blocks) => {
  reset();
  const store = new ContextBlockStore(() => {});
  registerContextPanel({ subscriptions: [] }, store);
  for (const b of blocks) {
    store.add(b);
  }
  return store;
};

test("close: onDidCloseTextDocument marks the uri lapsed, keyed on uri.toString()", () => {
  const store = panelWith([{ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 2 }, text: "x", version: 1 }]);
  assert.strictEqual(__state.onClose.length, 1, "the close subscription is registered");
  __state.onClose[0]({ uri: uriOf("file:///w/a.rs") });
  assert.strictEqual(store.list()[0].lapsed, true, "the block lapsed");
});

test("rename: one renameUri per PAIR, and every pair in the event is applied", () => {
  const store = panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 1, endLine: 2 }, text: "x", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 2 }, text: "y", version: 1 },
  ]);
  assert.strictEqual(__state.onRename.length, 1, "the rename subscription is registered");
  __state.onRename[0]({
    files: [
      { oldUri: uriOf("file:///w/a.rs"), newUri: uriOf("file:///w/a2.rs") },
      { oldUri: uriOf("file:///w/b.rs"), newUri: uriOf("file:///w/b2.rs") },
    ],
  });
  assert.deepStrictEqual(store.list().map((e) => e.uri), ["file:///w/a2.rs", "file:///w/b2.rs"]);
});

test("delete: onDidDeleteFiles loses every block in the file", () => {
  const store = panelWith([{ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 2 }, text: "x", version: 1 }]);
  assert.strictEqual(__state.onDelete.length, 1, "the delete subscription is registered");
  __state.onDelete[0]({ files: [uriOf("file:///w/a.rs")] });
  assert.strictEqual(store.list()[0].lost, "deleted");
});

// The panel applies the pairs of one event through a uri-level rename, so
// applying them in arrival order let a chained rename carry a block through the
// middle address and on to the last one.
test("rename: a chained rename (a->b, b->c) in ONE event leaves the a block at b", () => {
  const store = panelWith([{ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 }]);
  __state.onRename[0]({
    files: [
      { oldUri: uriOf("file:///w/a.rs"), newUri: uriOf("file:///w/b.rs") },
      { oldUri: uriOf("file:///w/b.rs"), newUri: uriOf("file:///w/c.rs") },
    ],
  });
  assert.strictEqual(store.list()[0].uri, "file:///w/b.rs", "the block follows its own file, once");
});

// The same event with a block sitting at the middle address: it moves to c, and
// the block arriving from a stops at b. Both move exactly once.
test("rename: a chained rename over blocks at BOTH addresses moves each block once", () => {
  const store = panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "y", version: 1 },
  ]);
  __state.onRename[0]({
    files: [
      { oldUri: uriOf("file:///w/a.rs"), newUri: uriOf("file:///w/b.rs") },
      { oldUri: uriOf("file:///w/b.rs"), newUri: uriOf("file:///w/c.rs") },
    ],
  });
  assert.deepStrictEqual(store.list().map((e) => e.uri), ["file:///w/b.rs", "file:///w/c.rs"]);
});

// The store's notify() propagates a listener's exception to the mutating caller
// BY DESIGN, so a handler that loops over the event's files without a guard
// abandons the rest of the event and throws into vscode's dispatcher.
test("delete: a throwing subscriber during a two-file delete still loses the second file's blocks", () => {
  const store = panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "y", version: 1 },
  ]);
  let armed = false;
  store.subscribe(() => {
    if (armed) {
      throw new Error("a repaint blew up");
    }
  });
  armed = true;
  assert.doesNotThrow(
    () => __state.onDelete[0]({ files: [uriOf("file:///w/a.rs"), uriOf("file:///w/b.rs")] }),
    "the throw does not escape into the event dispatcher",
  );
  assert.deepStrictEqual(
    store.list().map((e) => e.lost),
    ["deleted", "deleted"],
    "every file named by the event is lost",
  );
});

test("rename: a throwing subscriber during a two-file rename still moves the second file's blocks", () => {
  const store = panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "y", version: 1 },
  ]);
  let armed = false;
  store.subscribe(() => {
    if (armed) {
      throw new Error("a repaint blew up");
    }
  });
  armed = true;
  assert.doesNotThrow(
    () =>
      __state.onRename[0]({
        files: [
          { oldUri: uriOf("file:///w/a.rs"), newUri: uriOf("file:///w/a2.rs") },
          { oldUri: uriOf("file:///w/b.rs"), newUri: uriOf("file:///w/b2.rs") },
        ],
      }),
    "the throw does not escape into the event dispatcher",
  );
  assert.deepStrictEqual(store.list().map((e) => e.uri), ["file:///w/a2.rs", "file:///w/b2.rs"]);
});

// The documented folder limitation. VS Code fires onDidDeleteFiles with the
// FOLDER's uri and none for the files under it, so the handler cannot mark
// them; the resolve is where they go lost, because the reader cannot read a
// file that is gone.
test("delete of a FOLDER marks nothing, and the blocks under it go lost at the next resolve", async () => {
  const store = panelWith([{ uri: "file:///w/dir/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 }]);
  __state.onDelete[0]({ files: [uriOf("file:///w/dir")] });
  assert.strictEqual(store.list()[0].lost, undefined, "the event names the folder, not the file");
  const blocks = await store.resolveForPrompt(async () => undefined);
  assert.deepStrictEqual(blocks, [], "the block reaches no prompt");
  assert.strictEqual(store.list()[0].lost, "deleted", "and it self-heals into an honest loss");
});

// ---------------------------------------------------------------------------
// The loss toast: the surface that stops a block dropping out of a prompt in
// silence. Until it existed, an edit crossing a block left a channel line and
// nothing else, and an accept splice IS a change event, so both accept paths
// could lose a block without a word to the human.
// ---------------------------------------------------------------------------

const TEN_LINES = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n";
const changeDoc = (uri, version, text) => ({ uri: uriOf(uri), version, getText: () => text });
const change = (startLine, startCharacter, endLine, endCharacter, text) => ({
  range: {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  },
  text,
});
// The toast is fired without being awaited (an event handler cannot block the
// dispatcher on a human), so its action handling lands a turn later.
const settle = () => new Promise((r) => setTimeout(r, 0));
const toasts = () =>
  __state.messages.filter((m) => m.kind === "warn" && /context block/.test(m.message));

// Three blocks in one file, plus one in another the event must not touch.
const threeBlocksAcross = () =>
  panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "l2\nl3", version: 1 },
    { uri: "file:///w/a.rs", range: { startLine: 5, endLine: 6 }, text: "l5\nl6", version: 1 },
    { uri: "file:///w/a.rs", range: { startLine: 8, endLine: 9 }, text: "l8\nl9", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 },
  ]);

// Replaces L2 through the start of L9 with one line, which crosses all three
// blocks in a.rs at once. This is the refactor shape the design names.
const crossAllThree = () => [change(1, 0, 8, 0, "X\n")];

test("change: ONE crossing edit that takes three blocks raises ONE toast naming all three", async () => {
  const store = threeBlocksAcross();
  assert.strictEqual(__state.onChange.length, 1, "the change subscription is registered");
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
    contentChanges: crossAllThree(),
  });
  await settle();
  assert.deepStrictEqual(
    store.list().map((e) => e.lost),
    ["crossed", "crossed", "crossed", undefined],
    "sanity: the edit crossed all three and left the other file alone",
  );
  const warned = toasts();
  assert.strictEqual(warned.length, 1, `one event, one notification; got ${warned.length}`);
  for (const named of ["a.rs L2-L3", "a.rs L5-L6", "a.rs L8-L9"]) {
    assert.ok(warned[0].message.includes(named), `the toast names ${named}: ${warned[0].message}`);
  }
  assert.ok(!warned[0].message.includes("b.rs"), "and names nothing it did not take");
  assert.deepStrictEqual(warned[0].actions, ["Remove", "Show"], "both actions are offered");
});

test("change: an edit that loses nothing raises no toast at all", async () => {
  const store = threeBlocksAcross();
  // An insert above every block: they all shift, none is lost.
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, `new\n${TEN_LINES}`),
    contentChanges: [change(0, 0, 0, 0, "new\n")],
  });
  await settle();
  assert.deepStrictEqual(store.list().map((e) => e.range.startLine), [3, 6, 9, 1], "sanity: they shifted");
  assert.strictEqual(toasts().length, 0, "a shift is not news");
});

test("change: a SECOND event over already-lost blocks does not toast them again", async () => {
  threeBlocksAcross();
  const fire = () =>
    __state.onChange[0]({
      document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
      contentChanges: crossAllThree(),
    });
  fire();
  fire();
  await settle();
  assert.strictEqual(toasts().length, 1, "lost is terminal, so only the event that lost them says so");
});

test("delete: a TWO-FILE delete event raises ONE toast naming every block it took", async () => {
  panelWith([
    { uri: "file:///w/a.rs", range: { startLine: 2, endLine: 3 }, text: "x", version: 1 },
    { uri: "file:///w/b.rs", range: { startLine: 7, endLine: 9 }, text: "y", version: 1 },
  ]);
  __state.onDelete[0]({ files: [uriOf("file:///w/a.rs"), uriOf("file:///w/b.rs")] });
  await settle();
  const warned = toasts();
  assert.strictEqual(warned.length, 1, `one event, one notification; got ${warned.length}`);
  assert.ok(warned[0].message.includes("a.rs L2-L3"), warned[0].message);
  assert.ok(warned[0].message.includes("b.rs L7-L9"), warned[0].message);
});

test("delete: a delete event that takes no block raises no toast", async () => {
  panelWith([{ uri: "file:///w/a.rs", range: { startLine: 1, endLine: 1 }, text: "x", version: 1 }]);
  __state.onDelete[0]({ files: [uriOf("file:///w/unrelated.rs")] });
  await settle();
  assert.strictEqual(toasts().length, 0);
});

test("toast Remove clears exactly the blocks the toast NAMED, and nothing else", async () => {
  const store = threeBlocksAcross();
  const ids = store.list().map((e) => e.id);
  // The human removed the middle one by hand while the toast sat on screen, then
  // clicked Remove. The button must survive that rather than throwing or taking
  // a neighbour with it.
  __state.warnResponses = [
    () => {
      store.remove(ids[1]);
      return "Remove";
    },
  ];
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
    contentChanges: crossAllThree(),
  });
  await settle();
  assert.deepStrictEqual(
    store.list().map((e) => e.id),
    [ids[3]],
    "the three named blocks are gone and the healthy one in the other file stays",
  );
});

test("toast Remove after the human already cleared the panel removes nothing and throws nothing", async () => {
  const store = threeBlocksAcross();
  __state.warnResponses = [
    () => {
      store.clear();
      return "Remove";
    },
  ];
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
    contentChanges: crossAllThree(),
  });
  await settle();
  assert.deepStrictEqual(store.list(), []);
});

test("toast dismissed: neither action taken leaves every block exactly where it was", async () => {
  const store = threeBlocksAcross();
  __state.warnResponses = [undefined];
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
    contentChanges: crossAllThree(),
  });
  await settle();
  assert.strictEqual(store.list().length, 4, "a lost block stays listed until the human says otherwise");
});

test("toast Show reveals the panel instead of removing anything", async () => {
  const store = threeBlocksAcross();
  __state.warnResponses = ["Show"];
  __state.onChange[0]({
    document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
    contentChanges: crossAllThree(),
  });
  await settle();
  assert.ok(
    __state.executed.includes("column80.contextBlocks.focus"),
    `Show focuses the tree view; commands run: ${JSON.stringify(__state.executed)}`,
  );
  assert.strictEqual(store.list().length, 4, "and Show is not Remove");
});

test("toast Show when the focus command REJECTS does not leak an unhandled rejection into the host", async () => {
  // `<viewId>.focus` is contributed by VS Code, not registered by us, so a
  // renamed view or an older host makes it reject. The toast is fired without
  // being awaited (an event handler cannot block the dispatcher on a human), so
  // nothing downstream is left to catch it and the host logs an unhandled
  // rejection at the human instead.
  const rejections = [];
  const onUnhandled = (err) => rejections.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const store = threeBlocksAcross();
    __state.executeThrows = "command 'column80.contextBlocks.focus' not found";
    __state.warnResponses = ["Show"];
    __state.onChange[0]({
      document: changeDoc("file:///w/a.rs", 2, "l1\nX\nl9\nl10\n"),
      contentChanges: crossAllThree(),
    });
    await settle();
    await settle();
    assert.strictEqual(store.list().length, 4, "and the failed reveal took nothing with it");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepStrictEqual(
    rejections.map((e) => String(e.message ?? e)),
    [],
    "the toast's action handler let a rejection escape",
  );
});

// ---------------------------------------------------------------------------
// The tree row, over the real vscode surface. `blockRowShape` decides; this is
// the half that turns the decision into pixels, and it used to decide "is this
// row lost" a SECOND time, from a second field.
// ---------------------------------------------------------------------------

test("tooltip: a lost row whose reason has no sentence still gets the LOST tooltip, not the healthy one", () => {
  // A fourth LostReason with no sentence behind it is not reachable through the
  // closed union today. What this pins is that adding one cannot fail silently
  // and in the worst direction: the icon and the tooltip must be decided by the
  // SAME field, or a red row promises the human that the model gets these lines.
  reset();
  const provider = new ContextBlockTreeProvider({ list: () => [] });
  const item = provider.getTreeItem({
    id: "b1",
    uri: "file:///w/a.rs",
    range: { startLine: 3, endLine: 6 },
    text: "l3\nl4",
    addedAtVersion: 1,
    lost: "evicted",
  });
  assert.strictEqual(item.description, "L3-L6 (lost)", "control: the row reads lost");
  assert.strictEqual(item.iconPath.id, "error", "control: the row paints red");
  assert.match(
    String(item.tooltip),
    /reaches no prompt/,
    `a red row carried the healthy tooltip: ${item.tooltip}`,
  );
  assert.ok(
    !/as they read at generate time/.test(String(item.tooltip)),
    `a lost block promises nothing about generate time: ${item.tooltip}`,
  );
});

// ---------------------------------------------------------------------------
// Harness B: the generate-time warning, through the manual repair command's ctx.
// ---------------------------------------------------------------------------
const SRC = "fn broken() -> i32 {\n    return 1;\n}\n";
const lineStarts = (() => {
  const starts = [0];
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") starts.push(i + 1);
  return starts;
})();
const offsetAt = (pos) => lineStarts[pos.line] + pos.character;
const doc = {
  languageId: "rust",
  version: 1,
  isDirty: false,
  isClosed: false,
  uri: { fsPath: "/broken.rs", path: "/broken.rs", scheme: "file", toString: () => "file:///broken.rs" },
  getText(range) {
    return range ? SRC.slice(offsetAt(range.start), offsetAt(range.end)) : SRC;
  },
  offsetAt,
  positionAt(offset) {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return { line, character: offset - lineStarts[line], offset };
  },
  lineAt(line) {
    const text = SRC.split("\n")[line] ?? "";
    return { text, firstNonWhitespaceCharacterIndex: text.length - text.trimStart().length };
  },
  save: async () => true,
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};
const referenceProbe = () => ({
  runCommand: async () => ({ stdout: "16303\n", exitCode: 0 }),
  totalMemBytes: () => 61826 * 1048576,
});
const waitFor = async (predicate, what, tries = 1200) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// Register fnGen, stage `blocks`, drive the manual repair command, and hand back
// the captured oracle ctx. Its readContextBlocks is the call site that announces
// dropped blocks, and the repair loop calls it once per round.
const driveManualRepair = async (stage) => {
  reset();
  const out = output();
  const oracleCalls = [];
  const store = new ContextBlockStore(() => {});
  registerFnGen({ subscriptions: [] }, out, store, {
    probeOpts: referenceProbe(),
    runOracle: async (ctx) => { oracleCalls.push(ctx); },
    listModels: async () => ["qwen3-coder:30b"],
    ollamaCheck: async () => ({ stdout: "ollama version 0.0.0", exitCode: 0 }),
  });
  await waitFor(() => out.lines.some((l) => l.startsWith("[carve] tier=")), "tier resolution");
  stage(store);
  __state.activeTextEditor = { document: doc, selection: { active: { line: 1, character: 4 } } };
  await __state.commands["column80.repairFunction"]();
  assert.strictEqual(oracleCalls.length, 1, "sanity: exactly one oracle pass");
  return { store, ctx: oracleCalls[0], out };
};

const stageLostBlock = (store) => {
  // No open document and no openable document, so the reader answers undefined
  // and the entry becomes lost:"deleted" on the first resolve.
  store.add({ uri: "file:///w/gone.rs", range: { startLine: 2, endLine: 4 }, text: "// staged", version: 1 });
};

test("the warning names the dropped block by its panel label and range", async () => {
  const { ctx } = await driveManualRepair(stageLostBlock);
  await ctx.readContextBlocks();
  const warn = __state.messages.find((m) => m.kind === "warn" && /context block/.test(m.message));
  assert.ok(warn, "a dropped block is announced");
  assert.ok(
    warn.message.includes(`${fileLabel("file:///w/gone.rs")} L2-L4`),
    `the toast names the block the way the tree does; got: ${warn.message}`,
  );
});

// The warning is per GESTURE, not per prompt. oracleSurface calls the reader
// once per repair round, so a per-call boolean threw two identical toasts for
// one invocation of the manual repair command.
test("two repair rounds of ONE gesture raise the lost-block warning once", async () => {
  const { ctx } = await driveManualRepair(stageLostBlock);
  await ctx.readContextBlocks(); // round 1
  await ctx.readContextBlocks(); // round 2
  const warns = __state.messages.filter((m) => m.kind === "warn" && /context block/.test(m.message));
  assert.strictEqual(warns.length, 1, `one gesture, one warning; got ${warns.length}`);
});

// The one-shot is spent where it fires, not where the gesture starts: a first
// round that drops nothing must leave the warning available to a later round.
test("a gesture whose FIRST round drops nothing still warns when a later round does", async () => {
  const { store, ctx } = await driveManualRepair((s) => {
    __state.textDocuments = [{ uri: uriOf("file:///w/notes.rs"), getText: () => "a\nb\nc\n" }];
    s.add({ uri: "file:///w/notes.rs", range: { startLine: 2, endLine: 2 }, text: "b", version: 1 });
  });
  await ctx.readContextBlocks();
  assert.strictEqual(
    __state.messages.filter((m) => m.kind === "warn" && /context block/.test(m.message)).length,
    0,
    "nothing was dropped, so nothing is announced",
  );
  // The file goes away between rounds, which is what the reader answering
  // undefined means.
  __state.textDocuments = [];
  await ctx.readContextBlocks();
  assert.strictEqual(store.list()[0].lost, "deleted", "sanity: the second round is where it drops");
  assert.strictEqual(
    __state.messages.filter((m) => m.kind === "warn" && /context block/.test(m.message)).length,
    1,
    "the round that dropped it is the one that says so",
  );
});
