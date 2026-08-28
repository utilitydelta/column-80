// Implementer oracle, session-v56 phase 3 (roadmap item 64, mechanical half):
// gaps the blind file leaves open.
//
// The blind file proves the surface end to end (fim discard -> channel line,
// no toast; fngen discard -> today's toast). What it cannot see:
//   * the seam is PRE-CONSENT only (the contract's post-review amendment):
//     the two during-generation causes route to onSystemDiscard, while every
//     post-Accept discard (changed/closed while previewing, editor refused
//     the edit) toasts in EVERY session, seam wired or not;
//   * a closed document discards through the seam too;
//   * a HUMAN reject never touches the seam - onSystemDiscard is a
//     system-discard surface only, and reject stats stay honest;
//   * the refine evidence line: a system discard of the refine proposal is
//     result=discarded, a human reject stays result=rejected;
//   * the call-site wiring: the fim session passes the callback, the fngen
//     session passes undefined (so toast ownership stays in present()), and
//     the routing is per session - a fngen session drained behind a fim one
//     is not painted with the fim surface;
//   * the repair evidence line: result=discarded for a discard (it read
//     result=rejected before this phase, contradicting the outcome log),
//     while a human reject keeps result=rejected;
//   * a fim discard still drains the pending slot exactly as before.
//
// Run: node --test test/impl-v56-p3-fim-discard-surface.test.cjs
// (needs cargo on PATH: the session rows run a real `cargo check`.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");

// ---------------------------------------------------------------------------
// vscode stub: rich enough for the REAL ProposalPresenter (preview provider,
// diff command, accept/reject commands, tab pruner) plus the oracle session
// flow. The diff tab's human is scripted per test: state.decide picks the
// gesture, state.beforeDecide runs first so a test can move the document
// version between the preview opening and the gesture landing.
// ---------------------------------------------------------------------------

const STUB = path.join(__dirname, ".impl-v56-p3-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = { config: {}, messages: [], statusBar: [], commands: {}, appliedEdits: [], decide: "accept", beforeDecide: undefined, applyEditResult: true };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() {} appendCodeblock() {} appendMarkdown() {} appendText() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p, with() { return this; } }),
  from: (parts) => ({ ...parts, fsPath: parts.path, toString: () => parts.scheme + "://" + parts.path + "?" + (parts.query || "") }),
  // fsPath strips the scheme, as the real Uri.parse does: the refine window
  // reader trusts fsPath, and a stub handing back "file:///x" as a disk path
  // makes every window read ENOENT.
  parse: (s) => { const p = String(s).replace(/^file:\\/\\//, ""); return { raw: s, fsPath: p, path: p, scheme: "file", toString: () => String(s), with() { return this; } }; },
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
};
module.exports = {
  __state: state,
  Position, Range, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString, Diagnostic, TabInputTextDiff, Uri,
  EndOfLine: { LF: 1, CRLF: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Method: 1, Function: 2, Field: 4, Variable: 5, Class: 6, Property: 9, Enum: 12, Constant: 20, Struct: 21 },
  ProgressLocation: { Notification: 15, Window: 10 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key in state.config ? state.config[key] : fallback) }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    textDocuments: [],
    applyEdit: async (edit) => { state.appliedEdits.push(edit); return state.applyEditResult; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createOutputChannel: (name) => ({ name, appendLine() {}, append() {}, show() {}, dispose() {} }),
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    visibleTextEditors: [],
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    setStatusBarMessage: (message) => { state.statusBar.push({ message }); return { dispose() {} }; },
    tabGroups: { all: [], activeTabGroup: undefined, onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      if (id === "vscode.diff") {
        // Scheduled: present() registers its decision resolver only after this
        // call resolves. beforeDecide runs first so a test can bump the
        // document version inside the preview window (the SECOND guard).
        const previewUri = args[1];
        setTimeout(() => {
          if (state.beforeDecide) state.beforeDecide();
          const cmd = state.commands[state.decide === "reject" ? "column80.proposalReject" : "column80.proposalAccept"];
          if (typeof cmd !== "function") throw new Error("harness fault: no decision command registered");
          cmd(previewUri);
        }, 0);
      }
      return undefined;
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v56-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v56-p3.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";
export { ProposalPresenter } from "../src/vscode/fnGen";
export { FnGenService } from "../src/core/fnGenService";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { runPostAcceptOracle, ProposalPresenter, FnGenService, __state } = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const resetState = () => {
  __state.config = {};
  __state.messages = [];
  __state.statusBar = [];
  __state.appliedEdits = [];
  __state.decide = "accept";
  __state.beforeDecide = undefined;
  __state.applyEditResult = true;
};

// In-memory document with a real, mutable version - all present() reads.
const memDoc = (text) => {
  const d = { text, version: 1, closed: false };
  return {
    languageId: "rust",
    isDirty: false,
    get isClosed() {
      return d.closed;
    },
    eol: 1,
    get version() {
      return d.version;
    },
    uri: { fsPath: "/mem/target.rs", path: "/mem/target.rs", scheme: "file", toString: () => "file:///mem/target.rs", with() { return this; } },
    getText(range) {
      return range === undefined ? d.text : d.text.slice(range.start.offset ?? 0, range.end.offset ?? d.text.length);
    },
    positionAt: (offset) => ({ line: 0, character: offset, offset }),
    offsetAt: (pos) => pos.offset ?? pos.character,
    save: async () => true,
    __bump: () => {
      d.version += 1;
    },
    __close: () => {
      d.closed = true;
    },
  };
};

const TEXT = "pub fn f() -> u32 {\n    0\n}\n";
const presentWith = async (over) => {
  const doc = memDoc(TEXT);
  const outcomes = [];
  const discards = [];
  const request = {
    document: doc,
    span: { start: 0, end: TEXT.length - 1 },
    versionAtResolve: doc.version,
    title: "f: generated body (preview)",
    text: "pub fn f() -> u32 {\n    1\n}",
    service: { logOutcome: (o, extra) => outcomes.push({ o, extra }) },
    onSystemDiscard: (why) => discards.push(why),
  };
  const outcome = await new ProposalPresenter({ subscriptions: [] }).present({ ...request, ...over(doc) });
  return { outcome, outcomes, discards, doc };
};

// ---- present(): the seam itself -------------------------------------------

test("first guard: a version race with onSystemDiscard goes to the callback, no toast, outcome log discarded", async () => {
  resetState();
  const { outcome, outcomes, discards } = await presentWith((doc) => {
    doc.__bump(); // the human typed after the resolve, before present()
    return {};
  });
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(discards, ["the document changed during generation"]);
  assert.deepStrictEqual(__state.messages, [], "the callback replaces the toast, it does not add to it");
  assert.deepStrictEqual(
    outcomes,
    [{ o: "discarded", extra: { discardedWhy: "the document changed during generation", discardedBecause: undefined } }],
    "the record is untouched by the surface change: the OUTCOME is still `discarded`, and the reason " +
      "rides beside it since v62 F6 so a caller routed away from the toast still has it. What " +
      "FnGenService writes for this detail is byte-identical (impl-v62-p5-reviewfixes row 15)",
  );
});

test("control: with no race the same rig accepts, so the discards below are the guards' doing", async () => {
  resetState();
  const { outcome } = await presentWith(() => ({}));
  assert.strictEqual(outcome, "accept");
  assert.strictEqual(__state.appliedEdits.length, 1);
});

test("second guard re-pinned (amendment): a race inside the preview window is post-Accept, so it TOASTS even in a fim session", async () => {
  resetState();
  let bump;
  // The version moves between the diff opening and the accept landing: the
  // human typed while the preview sat open. They clicked Accept on that diff,
  // so the edit failing to land is news they are owed, not background noise -
  // the seam stays silent and the toast fires despite being wired.
  __state.beforeDecide = () => bump();
  const { outcome, outcomes, discards } = await presentWith((doc) => {
    bump = () => doc.__bump();
    return {};
  });
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(discards, [], "post-Accept causes never reach onSystemDiscard");
  assert.deepStrictEqual(
    __state.messages.map((m) => `${m.kind}: ${m.message}`),
    ["warn: Column 80: generation discarded — the document changed while previewing."],
    "the toast fires with today's wording, seam or no seam",
  );
  assert.deepStrictEqual(
    outcomes,
    [{ o: "discarded", extra: { discardedWhy: "the document changed while previewing", discardedBecause: undefined } }],
    "the record is unchanged by the surface split: the outcome token, plus the v62 F6 reason",
  );
});

test("editor refused the edit: post-Accept, toasts in every session, outcome log still discarded", async () => {
  resetState();
  __state.applyEditResult = false; // applyEdit round trip fails after consent
  const { outcome, outcomes, discards } = await presentWith(() => ({}));
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(discards, [], "a refused applyEdit is not a background race");
  assert.deepStrictEqual(
    __state.messages.map((m) => `${m.kind}: ${m.message}`),
    ["warn: Column 80: generation discarded — the editor refused the edit."],
  );
  assert.deepStrictEqual(outcomes, [
    { o: "discarded", extra: { discardedWhy: "the editor refused the edit", discardedBecause: undefined } },
  ]);
});

test("closed document discards through the seam, not a toast", async () => {
  resetState();
  const { outcome, discards } = await presentWith((doc) => {
    doc.__close();
    return {};
  });
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(discards, ["the document was closed during generation"]);
  assert.deepStrictEqual(__state.messages, []);
});

test("no onSystemDiscard: the warning toast fires with today's exact wording (the explicit-gesture surface)", async () => {
  resetState();
  const { outcome, discards } = await presentWith((doc) => {
    doc.__bump();
    return { onSystemDiscard: undefined };
  });
  assert.strictEqual(outcome, "discarded");
  assert.deepStrictEqual(discards, []);
  assert.deepStrictEqual(
    __state.messages.map((m) => `${m.kind}: ${m.message}`),
    ["warn: Column 80: generation discarded — the document changed during generation."],
  );
});

test("a HUMAN reject never touches the seam: onSystemDiscard silent, outcome log says reject", async () => {
  resetState();
  __state.decide = "reject";
  const { outcome, outcomes, discards } = await presentWith(() => ({}));
  assert.strictEqual(outcome, "reject");
  assert.deepStrictEqual(discards, [], "the seam is for SYSTEM discards only; a human verdict must not look like one");
  assert.strictEqual(outcomes.length, 1);
  assert.strictEqual(outcomes[0].o, "reject");
  assert.deepStrictEqual(__state.messages, [], "a reject toasts nothing, exactly as before");
});

// ---------------------------------------------------------------------------
// Session-level wiring: real cargo on scratch repairbench copies, scripted
// model replies through the REAL generateRaw seam, a recording presenter
// standing at the consent gate so each row can play the discard.
// ---------------------------------------------------------------------------

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `impl-v56-p3-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  const f = path.join(dir, "src", "task1.rs");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
  return { dir, file: f };
};

const fileDocument = (file) => ({
  languageId: "rust",
  isDirty: false,
  isClosed: false,
  version: 1,
  uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
  getText(range) {
    const t = fs.readFileSync(file, "utf8");
    return range ? t.slice(range.start.offset, range.end.offset) : t;
  },
  positionAt(offset) {
    const t = fs.readFileSync(file, "utf8");
    const before = t.slice(0, offset);
    const nl = before.lastIndexOf("\n");
    return { offset, line: before.split("\n").length - 1, character: offset - nl - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
});

const fnResolver = (fnName) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) {
    return undefined;
  }
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment: undefined,
    symbolName: fnName,
    languageId: "rust",
  };
};

const scriptedService = () => {
  const svcLines = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async () => ({ text: "```rust\npub fn parse_duration() {}\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" }),
    (l) => svcLines.push(l),
  );
  return { service, svcLines };
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// Presenter stand-in that plays a version-race discard the way the real one
// does: route the why through onSystemDiscard when the caller passed one,
// otherwise toast - then report "discarded". Records what it was handed.
const discardingPresenter = () => {
  const seen = [];
  return {
    seen,
    present: async (req) => {
      seen.push(req);
      const why = "the document changed during generation";
      if (req.onSystemDiscard !== undefined) {
        req.onSystemDiscard(why);
      } else {
        __state.messages.push({ kind: "warn", message: `Column 80: generation discarded — ${why}.` });
      }
      req.service.logOutcome("discarded");
      return "discarded";
    },
  };
};

const sessionCtx = (file, source, presenter, out) => ({
  document: fileDocument(file),
  landedSpan: { start: 0, end: 10 },
  source,
  service: scriptedService().service,
  output: out,
  presenter,
  resolveFunction: fnResolver("parse_duration"),
  repairTierGate: { allowed: true },
});

test("fim session: the presenter is handed onSystemDiscard, the channel carries the story and result=discarded with the why", async () => {
  resetState();
  const { dir, file } = scratchCopy("fim");
  try {
    const presenter = discardingPresenter();
    const out = output();
    await runPostAcceptOracle(sessionCtx(file, "fim", presenter, out));
    assert.strictEqual(presenter.seen.length, 1, `one proposal expected, got ${presenter.seen.length}`);
    assert.strictEqual(typeof presenter.seen[0].onSystemDiscard, "function", "the fim session must route system discards to its channel");
    assert.ok(
      out.lines.some((l) => /^\[repair\] round 1 proposal for parse_duration discarded — the document changed during generation \(background fim session: no toast\)$/.test(l)),
      `the story line names what and why, got ${JSON.stringify(out.lines)}`,
    );
    assert.ok(
      out.lines.includes("[repair] outcome round=1 result=discarded (the document changed during generation)"),
      `the evidence line agrees with the outcome log, got ${JSON.stringify(out.lines)}`,
    );
    assert.ok(!out.lines.some((l) => l.includes("result=rejected")), "a discard is not a rejection");
    assert.deepStrictEqual(__state.messages, [], "no toast anywhere in the fim session's discard");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fngen session: the presenter is handed NO onSystemDiscard (toast ownership stays in present), result=discarded not rejected", async () => {
  resetState();
  const { dir, file } = scratchCopy("fngen");
  try {
    const presenter = discardingPresenter();
    const out = output();
    await runPostAcceptOracle(sessionCtx(file, "fngen", presenter, out));
    assert.strictEqual(presenter.seen.length, 1);
    assert.strictEqual(presenter.seen[0].onSystemDiscard, undefined, "an explicit gesture keeps the presenter's own toast");
    assert.strictEqual(__state.messages.length, 1, "the toast fired (played by the presenter stand-in, as present() would)");
    assert.ok(
      out.lines.includes("[repair] outcome round=1 result=discarded"),
      `the evidence line says discarded even without a captured why, got ${JSON.stringify(out.lines)}`,
    );
    assert.ok(!out.lines.some((l) => l.includes("result=rejected")), "a discard is not a rejection");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a human reject still ends the round with result=rejected", async () => {
  resetState();
  const { dir, file } = scratchCopy("reject");
  try {
    const out = output();
    await runPostAcceptOracle(sessionCtx(file, "fngen", { present: async () => "reject" }, out));
    assert.ok(out.lines.includes("[repair] outcome round=1 result=rejected"), `got ${JSON.stringify(out.lines)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- refine evidence line: system discard vs human reject ------------------
// The refine proposal's outcome line read result=rejected for BOTH verdicts
// (`if (proposal !== "accept")`), calling the product's own discard a human
// reject - the same defect the repair round shed in this phase. Refine is only
// reachable as a manual gesture, so no why threads through: the presenter's
// return value alone carries the split, and the clean crate + manualRefine +
// reference-answering extractor below is the minimum rig that reaches it.

const cleanCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `impl-v56-p3-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return { dir, file: path.join(dir, "src", "task1.rs") };
};

const refineCtx = (dir, file, presenter, out) => ({
  document: fileDocument(file),
  landedSpan: { start: 0, end: 10 },
  source: "fngen",
  service: scriptedService().service,
  output: out,
  presenter,
  resolveFunction: async (document) => {
    const base = await fnResolver("parse_duration")(document);
    return base === undefined ? undefined : { ...base, kind: "function", bodyOnly: false, headerIndent: "", bodyIndent: "" };
  },
  repairTierGate: { allowed: true },
  manualRefine: true,
  extractor: {
    completeMembers: async () => [],
    example: async () => undefined,
    membersOfType: async () => [],
    references: async () => [
      { uri: "file://" + path.join(dir, "src", "lib.rs"), line: 2, character: 4, endLine: 2, endCharacter: 8 },
    ],
  },
});

test("refine: a system discard of the proposal logs result=discarded, never result=rejected", async () => {
  resetState();
  const { dir, file } = cleanCopy("refdisc");
  try {
    const out = output();
    await runPostAcceptOracle(refineCtx(dir, file, { present: async () => "discarded" }, out));
    assert.ok(
      out.lines.includes("[repair] refine outcome round=1 result=discarded"),
      `the evidence line agrees with the outcome log, got ${JSON.stringify(out.lines)}`,
    );
    assert.ok(!out.lines.some((l) => l.includes("result=rejected")), "a discard is not a rejection on the refine line either");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refine control: a human reject keeps result=rejected", async () => {
  resetState();
  const { dir, file } = cleanCopy("refrej");
  try {
    const out = output();
    await runPostAcceptOracle(refineCtx(dir, file, { present: async () => "reject" }, out));
    assert.ok(out.lines.includes("[repair] refine outcome round=1 result=rejected"), `got ${JSON.stringify(out.lines)}`);
    assert.ok(!out.lines.some((l) => l.includes("result=discarded")), "a human verdict must not be repainted as the product's");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("drain unchanged: a fim discard still drains the pending slot, and the drained fngen session is not painted with the fim surface", async () => {
  resetState();
  const a = scratchCopy("drainA");
  const b = scratchCopy("drainB");
  try {
    const pa = discardingPresenter();
    const pb = discardingPresenter();
    const outA = output();
    const outB = output();
    const runA = runPostAcceptOracle(sessionCtx(a.file, "fim", pa, outA));
    const runB = runPostAcceptOracle(sessionCtx(b.file, "fngen", pb, outB));
    await Promise.all([runA, runB]);
    // Drain is fire-and-forget: wait for the parked session's own evidence.
    for (let i = 0; i < 200 && pb.seen.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(outB.lines.some((l) => l.startsWith("[oracle] check queued")), `b must have parked behind a, got ${JSON.stringify(outB.lines)}`);
    assert.strictEqual(pa.seen.length, 1, "the fim session reached its proposal and discarded");
    assert.strictEqual(pb.seen.length, 1, "the fim discard must not strand the pending slot");
    assert.strictEqual(pb.seen[0].onSystemDiscard, undefined, "the drained fngen session keeps the toast surface: routing is per session, read at its own present call");
  } finally {
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});
