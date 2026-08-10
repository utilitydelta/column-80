// Implementer oracle for v9 two-language coexistence: one project root
// holding BOTH a Cargo.toml and a tsconfig.json, exercised through the real
// post-accept flow (real cargo check, real project tsc). The invariant under
// test is the composite session key sessionKey(language, root) in
// src/vscode/oracleSurface.ts: two languages sharing one root must never
// supersede each other's parked checks. Until TsOracle registered, only one
// oracle existed and this could not be falsified.
//
// Run: node --test test/impl-v9-twolang.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v9-twolang-stub.cjs");
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
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  joinPath: (base, ...segs) => Uri.file(path.join(base.fsPath, ...segs)),
  parse: (s) => ({ raw: s, toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
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

const entry = path.join(__dirname, ".impl-v9-twolang.entry.ts");
const outfile = path.join(__dirname, ".impl-v9-twolang.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { runPostAcceptOracle, registerOracleSurface } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { __state } from "vscode";\n`,
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { runPostAcceptOracle, registerOracleSurface, FnGenService, __state } = require(outfile);
test.after(() => {
  fs.rmSync(entry, { force: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(STUB, { force: true });
});

// One scratch root carrying BOTH languages: a rust crate (Cargo.toml +
// src/lib.rs with a type error) and a TS project (tsconfig.json +
// ts-src/app.ts with a type error). node_modules/typescript symlinks to this
// repo's own install so TsOracle's version-honesty detection resolves.
const mkTwolangRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v9-twolang-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "ts-src"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(
    path.join(root, "Cargo.toml"),
    '[package]\nname = "twolang"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n',
  );
  fs.writeFileSync(path.join(root, "src", "lib.rs"), 'pub fn answer() -> i32 { "thirty" }\n');
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions": {"strict": true, "noEmit": true}, "include": ["ts-src/**/*"]}\n',
  );
  fs.writeFileSync(path.join(root, "ts-src", "app.ts"), 'const n: number = "thirty";\n');
  fs.symlinkSync(
    path.join(__dirname, "..", "node_modules", "typescript"),
    path.join(root, "node_modules", "typescript"),
    "dir",
  );
  return root;
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
      return { text: "```rust\n" + text + "\n```", ttftMs: 1, totalMs: 2, doneReason: "stop" };
    },
  );
  return { service, prompts };
};

const output = () => {
  const lines = [];
  return { lines, appendLine: (l) => lines.push(l) };
};

// One accept context per language. resolveFunction resolves nothing: with
// repairEnabled=false the session never reaches a repair round, and an
// unresolved function scopes to the landed span, which is all these tests need.
const mkAccept = (file, over = {}) => {
  const out = output();
  return {
    out,
    ctx: {
      document: fileDocument(file, over),
      landedSpan: { start: 0, end: 10 },
      source: "fngen",
      service: scriptedService([]).service,
      output: out,
      presenter: recordingPresenter(file),
      resolveFunction: async () => undefined,
    },
  };
};

const waitFor = async (predicate, what) => {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const doneLine = (l) => l.startsWith("[oracle] check done");

test("composite session key: a parked TS accept survives a rust accept on the same root", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  const root = mkTwolangRoot();
  try {
    const libRs = path.join(root, "src", "lib.rs");
    const appTs = path.join(root, "ts-src", "app.ts");
    const a = mkAccept(libRs);
    const b = mkAccept(appTs, { languageId: "typescript" });
    const c = mkAccept(libRs);
    const pA = runPostAcceptOracle(a.ctx); // runs: rust session on the root
    const pB = runPostAcceptOracle(b.ctx); // parks in the TYPESCRIPT slot for the root
    const pC = runPostAcceptOracle(c.ctx); // parks in the RUST slot: root-only keying would supersede b here
    await Promise.all([pA, pB, pC]);
    await waitFor(() => b.out.lines.some(doneLine), "the parked TS session to drain and run");
    await waitFor(() => c.out.lines.some(doneLine), "the parked rust session to drain and run");

    assert.ok(b.out.lines.includes(`[oracle] check queued crate=${root}`), `b parked, got ${JSON.stringify(b.out.lines)}`);
    assert.ok(
      !b.out.lines.includes(`[oracle] check superseded crate=${root}`),
      "the rust accept must not supersede the parked TS accept: they share a root, not a language",
    );
    assert.ok(c.out.lines.includes(`[oracle] check queued crate=${root}`), "c parked while a ran");
    const done = [...a.out.lines, ...b.out.lines, ...c.out.lines].filter(doneLine);
    assert.strictEqual(done.length, 3, "all three accepts ran a check: nothing was subsumed across languages");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// DELETED (human call): "mirror ownership" pinned that a TS check replaced only
// its own mirrored keys and left the rust ones on the same root alone. The
// extension publishes no diagnostics now, so there is nothing to own. Two
// languages sharing a root is still covered above, where it belongs: the check
// queue, keyed on (language, root), which is the part that was ever load-bearing.
test("no diagnostics: a check with errors publishes nothing, in either language", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  registerOracleSurface({ subscriptions: [] }, output());
  assert.strictEqual(__state.collections.length, 0, "registration creates no DiagnosticCollection");
  const root = mkTwolangRoot();
  try {
    await runPostAcceptOracle(mkAccept(path.join(root, "src", "lib.rs")).ctx);
    await runPostAcceptOracle(mkAccept(path.join(root, "ts-src", "app.ts"), { languageId: "typescript" }).ctx);
    assert.strictEqual(__state.collections.length, 0, "and neither check creates one on the way past");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TS session end to end: evidence lines and honest verdict", async () => {
  resetState();
  __state.config = { repairEnabled: false };
  registerOracleSurface({ subscriptions: [] }, output());
  const root = mkTwolangRoot();
  try {
    const appTs = path.join(root, "ts-src", "app.ts");
    const b = mkAccept(appTs, { languageId: "typescript" });
    await runPostAcceptOracle(b.ctx);

    assert.ok(
      b.out.lines.some((l) => l.startsWith(`[oracle] check crate=${root} file=${appTs}`)),
      `the check names the shared root as its crate, got ${JSON.stringify(b.out.lines)}`,
    );
    assert.ok(
      b.out.lines.some((l) => /^\[oracle\] check done ms=\d+ errors=1 warnings=0 success=false$/.test(l)),
      `honest verdict from the project's own tsc, got ${JSON.stringify(b.out.lines)}`,
    );
    // The mirror assertions here are SUPERSEDED with the rest of the Problems
    // mirror. That tsc's TS2322 is parsed into a code is pinned on the parser
    // itself (blind-v9-tsoracle), which is where it belongs; what this row still
    // proves is that the shared root and the honest verdict reach the channel.
    assert.strictEqual(__state.collections.length, 0, "the errors reach the channel, not the Problems panel");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
