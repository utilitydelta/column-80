// Implementer oracle: the vscode layer of phase 4, bundled against a stub
// `vscode` module so the post-accept flow runs headless. Real cargo on
// scratch copies of repairbench, scripted model replies through the REAL
// FnGenService.generateRaw seam, a recording presenter standing where the
// consent gate sits. Covers: the appliesTo gate, the repairEnabled gate
// with evidence, the wave scenario (E0599 -> E0596, the pair proven on
// this box) executed end to end within the cap, the edit-site annotation and
// its lifecycle, the FIM inline item's accept command, and the
// save-failure path.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl4-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const path = require("path");
const state = { config: {}, visibleTextEditors: [], collections: [], warnings: [], docChanges: [] };
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  translate(dl, dc) { return new Position(this.line + (dl || 0), this.character + (dc || 0)); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } }
class InlineCompletionItem { constructor(insertText, range) { this.insertText = insertText; this.range = range; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  joinPath: (base, ...segs) => Uri.file(path.join(base.fsPath, ...segs)),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, InlineCompletionItem, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => (key in state.config ? state.config[key] : fallback) }),
    textDocuments: [],
    // The check annotation retires on the first edit, so the surface subscribes
    // here; the handlers are recorded so a test can fire a document change.
    onDidChangeTextDocument: (fn) => { state.docChanges.push(fn); return { dispose() {} }; },
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = {
        name,
        entries: new Map(),
        sets: [],
        deletes: [],
        clears: 0,
        set(uri, list) { this.sets.push({ uri: uri.toString(), list }); this.entries.set(uri.toString(), list); },
        delete(uri) { this.deletes.push(uri.toString()); this.entries.delete(uri.toString()); },
        clear() { this.clears++; this.entries.clear(); },
        dispose() {},
      };
      state.collections.push(c);
      return c;
    },
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    showWarningMessage: (m) => { state.warnings.push(m); },
  },
};
`,
);

const entry = path.join(__dirname, ".impl4-vscode.entry.ts");
const outfile = path.join(__dirname, ".impl4-vscode.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { runPostAcceptOracle, registerOracleSurface } from "../src/vscode/oracleSurface";
export { FimCompletionProvider } from "../src/vscode/completionProvider";
export { FnGenService } from "../src/core/fnGenService";
export { __state, Position } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const {
  runPostAcceptOracle,
  registerOracleSurface,
  FimCompletionProvider,
  FnGenService,
  __state,
  Position,
} = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

const REPAIRBENCH = path.join(__dirname, "fixtures", "repairbench");
const scratchCopy = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `impl4-${tag}-`));
  fs.cpSync(REPAIRBENCH, dir, { recursive: true });
  return dir;
};

const resetState = () => {
  __state.config = {};
  __state.visibleTextEditors = [];
  __state.warnings = [];
  __state.docChanges.length = 0;
  for (const c of __state.collections) {
    c.sets.length = 0;
    c.clears = 0;
  }
};

// File-backed document fake: positions are byte-offset wrappers, so the
// Range-based getText the flow performs slices the live file content.
const fileDocument = (file, over = {}) => ({
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
    return { offset, line: t.slice(0, offset).split("\n").length - 1 };
  },
  lineAt(line) {
    const t = fs.readFileSync(file, "utf8").split("\n")[line] ?? "";
    return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
  },
  save: async () => true,
  ...over,
});

// Span of a named fn in the file's CURRENT text, mirroring what the symbol
// provider would answer after each splice.
const fnResolver = (fnName, docComment) => async (document) => {
  const t = document.getText();
  const start = t.indexOf(`pub fn ${fnName}`);
  if (start < 0) {
    return undefined;
  }
  const end = t.indexOf("\n}", start) + 2;
  return {
    span: { start, end },
    signature: t.slice(start, t.indexOf("{", start)).trimEnd(),
    docComment,
    symbolName: fnName,
    languageId: "rust",
  };
};

// Consent-gate stand-in: records every proposal and applies it, the accept
// path. The REAL presenter is vscode-bound; its guard logic is phase-2
// territory. What phase 4 must prove here is that repair rounds have no
// splice path except a presenter.present call.
const recordingPresenter = (file) => {
  const proposals = [];
  return {
    proposals,
    present: async (req) => {
      proposals.push(req);
      const t = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, t.slice(0, req.span.start) + req.text + t.slice(req.span.end));
      return "accept";
    },
  };
};

const scriptedService = (replies) => {
  const prompts = [];
  const service = new FnGenService(
    { apiBase: "http://fake:1", model: "scripted-30b", fallbackModel: "x", maxTokens: 512, temperature: 0.2 },
    async (params) => {
      prompts.push(params.prompt);
      const text = replies[prompts.length - 1];
      assert.ok(text !== undefined, "scripted replies exhausted: more model calls than the scenario allows");
      return { text: "\`\`\`rust\n" + text + "\n\`\`\`", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

test("an unsupported-language document never spawns a check: the no-oracle gate covers every trigger", async () => {
  resetState();
  const { service, prompts } = scriptedService([]);
  const out = output();
  // plaintext has no registered oracle (python went live at v11, so it is no
  // longer the unsupported stand-in this gate needs — oracleFor('python') now
  // resolves a PyOracle). A genuinely unregistered id still exercises the gate.
  await runPostAcceptOracle({
    document: fileDocument("/tmp/nope.txt", { languageId: "plaintext" }),
    landedSpan: { start: 0, end: 1 },
    source: "fim",
    service,
    output: out,
    presenter: recordingPresenter("/tmp/nope.txt"),
    resolveFunction: fnResolver("f"),
  });
  assert.deepStrictEqual(out.lines, [], "no [oracle] evidence, no spawn");
  assert.deepStrictEqual(prompts, []);
});

test("a failed save rejects into the caller's catch line instead of checking a stale file", async () => {
  resetState();
  const crate = scratchCopy("dirty");
  try {
    const file = path.join(crate, "src", "task1.rs");
    const { service } = scriptedService([]);
    const doc = fileDocument(file, { isDirty: true, save: async () => false });
    await assert.rejects(
      () =>
        runPostAcceptOracle({
          document: doc,
          landedSpan: { start: 0, end: 1 },
          source: "fngen",
          service,
          output: output(),
          presenter: recordingPresenter(file),
          resolveFunction: fnResolver("parse_duration"),
        }),
      /could not save/,
    );
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("repairEnabled=false: check-and-surface still runs (real cargo), zero model calls, why=disabled evidence", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  const crate = scratchCopy("gate");
  try {
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const { service, prompts } = scriptedService([]);
    const presenter = recordingPresenter(file);
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service,
      output: out,
      presenter,
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.ok(out.lines.some((l) => /^\[oracle\] check done ms=\d+ errors=1 warnings=0 success=false$/.test(l)), `the oracle has no off switch, got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.includes("[repair] surface why=disabled errors=1 warnings=0"), `got ${JSON.stringify(out.lines)}`);
    assert.deepStrictEqual(prompts, [], "disabled means zero model calls");
    assert.deepStrictEqual(presenter.proposals, [], "and zero proposals");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("wave scenario end to end: E0599 masks E0596, two scripted rounds through generateRaw + presenter, re-check after every splice, clean inside the cap", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("wave");
  const file = path.join(crate, "src", "task2.rs");
  try {
    const original = fs.readFileSync(file, "utf8");
    const fnStart = original.indexOf("pub fn merge_sorted");
    const fnEnd = original.indexOf("\n}", fnStart) + 2;
    const correctFn = original.slice(fnStart, fnEnd);
    const noMutFn = correctFn.replace("let mut result", "let result");
    const brokenFn = noMutFn.split("result.push(").join("result.pushh(");
    fs.writeFileSync(file, original.slice(0, fnStart) + brokenFn + original.slice(fnEnd));

    // Round 1 fixes the name error but not the missing mut (the masked
    // borrow error), round 2 fixes everything: the proven E0599 -> E0596
    // unmasking pair drives a genuine second wave.
    const { service, prompts } = scriptedService([noMutFn, correctFn]);
    const presenter = recordingPresenter(file);
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: fnStart, end: fnStart + brokenFn.length },
      source: "fim",
      service,
      output: out,
      presenter,
      resolveFunction: fnResolver("merge_sorted"),
    });

    assert.strictEqual(prompts.length, 2, "exactly two model calls");
    assert.ok(prompts[0].includes("no method named `pushh`"), `round 1's diagnostics carry the name error, got ${JSON.stringify(prompts[0].slice(0, 400))}`);
    assert.ok(!prompts[0].includes("cannot borrow"), "round 1 must NOT see the borrow error: rustc masks it while the name error stands");
    assert.ok(prompts[1].includes("cannot borrow"), `round 2 saw the unmasked borrow error, got ${JSON.stringify(prompts[1].slice(0, 400))}`);
    assert.ok(!prompts[1].includes("no method named"), "round 1's fix held: the name error is gone from wave 2");
    assert.strictEqual(presenter.proposals.length, 2, "every splice went through the consent gate");

    const checks = out.lines.filter((l) => l.startsWith("[oracle] check done"));
    assert.strictEqual(checks.length, 3, "initial check + one re-check per executed splice (wave semantics)");
    assert.ok(/success=true$/.test(checks[2]), "final re-check clean");
    assert.ok(out.lines.some((l) => /^\[repair\] decision round=1\/2 route=cross-model source=fim eligible=\d+$/.test(l)), `got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => /^\[repair\] decision round=2\/2 route=self-repair source=fim eligible=\d+$/.test(l)), `got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => l.startsWith("[repair] round 1/2 model=") && l.endsWith("route=cross-model")), `executor round line, got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => /^\[repair\] outcome round=1 result=errors-remain=\d+$/.test(l)), `round 1 outcome names the remaining wave, got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.includes("[repair] outcome round=2 result=clean"), `got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => l.startsWith("[repair] surface why=clean")), `got ${JSON.stringify(out.lines)}`);
    const decisions = out.lines.filter((l) => l.startsWith("[repair] decision"));
    for (const d of decisions) {
      assert.ok(/round=[12]\/2/.test(d), `bar 4: a round outside 1-2 appeared: ${d}`);
    }
    assert.strictEqual(fs.readFileSync(file, "utf8"), original, "the repaired file converged to the known-good text");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("rejected proposal ends the session: one model call, outcome=rejected, diagnostics stay surfaced", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("reject");
  const file = path.join(crate, "src", "task1.rs");
  try {
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const { service, prompts } = scriptedService(["pub fn parse_duration() {}"]);
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service,
      output: out,
      presenter: { present: async () => "reject" },
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.strictEqual(prompts.length, 1);
    assert.ok(out.lines.includes("[repair] outcome round=1 result=rejected"), `got ${JSON.stringify(out.lines)}`);
    assert.strictEqual(out.lines.filter((l) => l.startsWith("[oracle] check done")).length, 1, "no re-check after a refused splice");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// SUPERSEDED (human call): this extension publishes no diagnostics. The mirror
// could only be replaced by the next check on the same root, so an error the
// human fixed by hand sat in Problems with nothing able to clear it. The
// language server publishes the same errors and owns their lifecycle properly.
// What the check still says out loud: the edit-site annotation and the channel.
test("display surface: NO diagnostic is ever published; the edit-site decoration summarizes at the landed line", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  registerOracleSurface({ subscriptions: [] }, output());
  assert.strictEqual(__state.collections.length, 0, "registration creates no DiagnosticCollection at all");
  const crate = scratchCopy("display");
  const file = path.join(crate, "src", "task1.rs");
  try {
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const doc = fileDocument(file);
    const decorationCalls = [];
    __state.visibleTextEditors = [
      { document: doc, setDecorations: (type, opts) => decorationCalls.push(opts) },
    ];
    await runPostAcceptOracle({
      document: doc,
      landedSpan: { start: fs.readFileSync(file, "utf8").indexOf("pub fn"), end: 400 },
      source: "fim",
      service: scriptedService([]).service,
      output: output(),
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.strictEqual(__state.collections.length, 0, "a check with errors still publishes no diagnostics");
    assert.strictEqual(decorationCalls.length, 1);
    assert.match(decorationCalls[0][0].renderOptions.after.contentText, /^cargo check: 1 error\(s\), 0 warning\(s\)$/);

    // The annotation is now the ONLY on-screen surface, so its lifecycle is the
    // whole question the Problems mirror got wrong. It describes the text as the
    // check saw it, so the human's first edit retires it. Without this the mirror
    // is back in miniature: a stale error nothing the human does can clear.
    assert.ok(__state.docChanges.length > 0, "the surface subscribes to document changes");
    for (const handler of __state.docChanges) {
      handler({ document: doc, contentChanges: [{}] });
    }
    assert.strictEqual(decorationCalls.length, 2, "the edit cleared the annotation");
    assert.deepStrictEqual(decorationCalls[1], [], "cleared means an empty range set, not a re-render");

    // An edit to a DIFFERENT document leaves it alone.
    const other = fileDocument(path.join(crate, "src", "task2.rs"));
    for (const handler of __state.docChanges) {
      handler({ document: other, contentChanges: [{}] });
    }
    assert.strictEqual(decorationCalls.length, 2, "another file's edit is not this file's annotation");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// The clean-check path: a re-check that comes back green takes the annotation
// down. Pinned because it is the only other way it ever disappears.
test("display surface: a clean re-check clears the edit-site annotation", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  registerOracleSurface({ subscriptions: [] }, output());
  const crate = scratchCopy("display-clean");
  const file = path.join(crate, "src", "task1.rs");
  try {
    const doc = fileDocument(file);
    const decorationCalls = [];
    __state.visibleTextEditors = [
      { document: doc, setDecorations: (type, opts) => decorationCalls.push(opts) },
    ];
    await runPostAcceptOracle({
      document: doc,
      landedSpan: { start: fs.readFileSync(file, "utf8").indexOf("pub fn"), end: 400 },
      source: "fim",
      service: scriptedService([]).service,
      output: output(),
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.strictEqual(decorationCalls.length, 1, "the clean check still touches the decoration");
    assert.deepStrictEqual(decorationCalls[0], [], "and it clears it: nothing to say about a green check");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("FIM inline item carries the accept command: post-accept trigger with uri, landed offset, and text length", async () => {
  resetState();
  __state.config = { enabled: true };
  const text = "let x = ";
  const doc = {
    languageId: "rust",
    uri: { toString: () => "file:///fake.rs" },
    lineCount: 1,
    getText: (range) => text.slice(range.start.character, range.end.character),
    lineAt: () => ({ range: { start: new Position(0, 0), end: new Position(0, text.length) }, text }),
    offsetAt: (pos) => pos.character,
  };
  const provider = new FimCompletionProvider(
    () => ({ complete: async () => ({ text: "1;" }) }),
    { appendLine: () => {} },
  );
  const items = await provider.provideInlineCompletionItems(
    doc,
    new Position(0, 8),
    { triggerKind: 1 },
    { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) },
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].command.command, "column80.fimAccepted");
  assert.deepStrictEqual(items[0].command.arguments, ["file:///fake.rs", 8, 2], "uri, landed start offset, accepted text length");
});

// ---- P4-F2: workspace-member scoping against the committed workspace fixture
// The mirror half of this row is SUPERSEDED with the rest of the Problems
// mirror; what survives is the half that still means something — a member's
// accept scopes the check to the member dir, not the workspace root.

const WORKSPACE_FIXTURE = path.join(__dirname, "fixtures", "workspace-fixture");

test("workspace member (P4-F2): the member dir scopes the check, and no diagnostic is published", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  registerOracleSurface({ subscriptions: [] }, output());
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "impl4-ws-"));
  try {
    fs.cpSync(WORKSPACE_FIXTURE, ws, { recursive: true });
    const file = path.join(ws, "member", "src", "lib.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("let sum: u64 = a + b;", 'let sum: u64 = "oops";'));
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service: scriptedService([]).service,
      output: out,
      presenter: recordingPresenter(file),
      resolveFunction: fnResolver("add_counts"),
    });
    assert.ok(out.lines.some((l) => l.includes(`crate=${path.join(ws, "member")}`)), `the member dir scoped the check, got ${JSON.stringify(out.lines)}`);
    assert.strictEqual(__state.collections.length, 0, "no diagnostics published for the member file either");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// DELETED (human call): "mirror own-keys (P4-F6)" pinned how one crate's check
// replaced its own mirrored keys without blanking another crate's. Careful
// bookkeeping over a surface that should not have existed. There is no mirror
// to keep honest now, and the row above proves nothing is published at all.
// Two crates running back to back is still covered by the single-flight rows.

// ---- P4-F6: single-flight, newest-pending-wins, supersession evidence

const waitFor = async (predicate, what) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
};

test("single-flight (P4-F6): concurrent accepts run serially; the middle pending accept is superseded with evidence and never runs", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  const crate = scratchCopy("flight");
  try {
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const mk = () => {
      const out = output();
      return {
        out,
        ctx: {
          document: fileDocument(file),
          landedSpan: { start: 0, end: 10 },
          source: "fngen",
          service: scriptedService([]).service,
          output: out,
          presenter: recordingPresenter(file),
          resolveFunction: fnResolver("parse_duration"),
        },
      };
    };
    const a = mk();
    const b = mk();
    const c = mk();
    const pA = runPostAcceptOracle(a.ctx);
    const pB = runPostAcceptOracle(b.ctx); // parks in the crate's pending slot
    const pC = runPostAcceptOracle(c.ctx); // newest wins: b is superseded
    await Promise.all([pA, pB, pC]);
    await waitFor(() => c.out.lines.some((l) => l.startsWith("[oracle] check done")), "the queued newest session to run");

    assert.ok(a.out.lines.some((l) => l.startsWith("[oracle] check done")), "first accept ran");
    assert.ok(b.out.lines.includes(`[oracle] check queued crate=${crate}`), `b parked, got ${JSON.stringify(b.out.lines)}`);
    assert.ok(b.out.lines.includes(`[oracle] check superseded crate=${crate}`), "b's supersession is on b's record");
    assert.ok(!b.out.lines.some((l) => l.startsWith("[oracle] check crate=")), "b never spawned a check");
    assert.ok(c.out.lines.includes(`[oracle] check queued crate=${crate}`), "c parked while a ran");
    const done = [...a.out.lines, ...c.out.lines].filter((l) => l.startsWith("[oracle] check done"));
    assert.strictEqual(done.length, 2, "exactly two sessions ran for three accepts");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

// ---- P4-F7: exactly one outcome line per executed round on every exit path

const outcomeLines = (lines) => lines.filter((l) => l.startsWith("[repair] outcome "));

test("outcome on save-failure after an accepted splice (P4-F7): result=failed logged exactly once, then the error propagates", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("saveout");
  try {
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const { service } = scriptedService(["pub fn parse_duration() {}"]);
    const doc = fileDocument(file);
    const out = output();
    const presenter = {
      present: async (req) => {
        // The splice leaves the buffer dirty and the save then fails.
        doc.isDirty = true;
        doc.save = async () => false;
        void req;
        return "accept";
      },
    };
    await assert.rejects(
      () =>
        runPostAcceptOracle({
          document: doc,
          landedSpan: { start: 0, end: 10 },
          source: "fngen",
          service,
          output: out,
          presenter,
          resolveFunction: fnResolver("parse_duration"),
        }),
      /could not save/,
    );
    assert.deepStrictEqual(outcomeLines(out.lines), ["[repair] outcome round=1 result=failed"], `got ${JSON.stringify(out.lines)}`);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("outcome when the re-check cannot run (P4-F7): crate root vanished after the splice -> result=failed, session ends cleanly", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("recheck");
  try {
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const { service } = scriptedService(["pub fn parse_duration() {}"]);
    const out = output();
    const presenter = {
      present: async () => {
        fs.rmSync(path.join(crate, "Cargo.toml"));
        return "accept";
      },
    };
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service,
      output: out,
      presenter,
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.deepStrictEqual(outcomeLines(out.lines), ["[repair] outcome round=1 result=failed"], `got ${JSON.stringify(out.lines)}`);
    assert.ok(out.lines.some((l) => l.startsWith("[oracle] check skipped: no crate root")), "the vanished root is on the record too");
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("outcome coverage across normal paths (P4-F7): rejected and wave scenarios each log exactly one outcome per executed round", async () => {
  resetState();
  __state.config = { repairEnabled: true };
  const crate = scratchCopy("outcount");
  try {
    const file = path.join(crate, "src", "task1.rs");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
    const { service } = scriptedService(["pub fn parse_duration() {}"]);
    const out = output();
    await runPostAcceptOracle({
      document: fileDocument(file),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service,
      output: out,
      presenter: { present: async () => "reject" },
      resolveFunction: fnResolver("parse_duration"),
    });
    assert.deepStrictEqual(outcomeLines(out.lines), ["[repair] outcome round=1 result=rejected"]);
  } finally {
    fs.rmSync(crate, { recursive: true, force: true });
  }
});

test("drain survives gate failure (P4-F13): two crates parked, head's Cargo.toml removed -> skip logged, second crate still runs without a fresh accept", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  const crateA = scratchCopy("drainA");
  const crateB = scratchCopy("drainB");
  const crateC = scratchCopy("drainC");
  try {
    const brk = (crate) => {
      const f = path.join(crate, "src", "task1.rs");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"s" => Some(number),', '"s" => Some("thirty"),'));
      return f;
    };
    const mk = (file) => {
      const out = output();
      return {
        out,
        ctx: {
          document: fileDocument(file),
          landedSpan: { start: 0, end: 10 },
          source: "fngen",
          service: scriptedService([]).service,
          output: out,
          presenter: recordingPresenter(file),
          resolveFunction: fnResolver("parse_duration"),
        },
      };
    };
    const a = mk(brk(crateA));
    const b = mk(brk(crateB));
    const c = mk(brk(crateC));
    const pA = runPostAcceptOracle(a.ctx); // running
    const pB = runPostAcceptOracle(b.ctx); // parked, head
    const pC = runPostAcceptOracle(c.ctx); // parked, second
    // The head context stops passing its entry gates before drain time.
    fs.rmSync(path.join(crateB, "Cargo.toml"));
    await Promise.all([pA, pB, pC]);
    await waitFor(() => c.out.lines.some((l) => l.startsWith("[oracle] check done")), "the second parked crate to drain past the invalid head");

    assert.ok(b.out.lines.includes(`[oracle] check queued crate=${crateB}`), "b parked");
    assert.ok(b.out.lines.some((l) => l.startsWith("[oracle] check skipped: no crate root for ")), `the drained head's gate failure is on its record, got ${JSON.stringify(b.out.lines)}`);
    assert.ok(!b.out.lines.some((l) => l.startsWith("[oracle] check done")), "b never ran a check");
    assert.ok(c.out.lines.some((l) => l.startsWith("[oracle] check done")), "c drained without waiting for a fresh accept");
  } finally {
    fs.rmSync(crateA, { recursive: true, force: true });
    fs.rmSync(crateB, { recursive: true, force: true });
    fs.rmSync(crateC, { recursive: true, force: true });
  }
});
