"use strict";

// session-v77 phase 4c, lane 2: the behaviour rows of the journey re-trace that live in the
// Repair Function Body surface (`oracleSurface.ts`) and the compiler oracle.
//
// `runPostAcceptOracle` is driven for real, bundled against a small vscode stub. Four seams it
// imports are swapped for fakes ONLY at oracleSurface's own import sites (the check, the covering
// test discovery and run, and the call-hierarchy anchor), so no toolchain, language server or
// model is spawned. Every other module is the product's own.
//
// Run: node --test test/impl-v77-p4-lane2.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const STUB = path.join(__dirname, ".impl-v77-p4-lane2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v77lane2 = globalThis.__v77lane2 || { messages: [], config: {} });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor() { this.blocks = []; } appendCodeblock(t) { this.blocks.push(t); } appendMarkdown() {} }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: "file", toString: () => "file://" + p }),
  parse: (s) => ({ raw: s, fsPath: String(s).replace(/^file:\\/\\//, ""), toString: () => s }),
};
module.exports = {
  __state: state,
  Position, Range, ThemeColor, MarkdownString, Diagnostic, Location, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Window: 10, Notification: 15 },
  workspace: {
    getConfiguration: () => ({
      get: (k, fb) => (k in state.config ? state.config[k] : fb),
      inspect: () => undefined,
      update: async () => {},
    }),
    get textDocuments() { return []; },
    get workspaceFolders() { return undefined; },
  },
  languages: {
    createDiagnosticCollection: (name) => ({ name, set() {}, delete() {}, clear() {}, dispose() {} }),
  },
  window: {
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return []; },
    showWarningMessage: async (message) => { state.messages.push({ kind: "warn", message }); },
    showInformationMessage: async (message) => { state.messages.push({ kind: "info", message }); },
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message }); return { dispose() {} }; },
  },
  commands: { executeCommand: async () => undefined },
};
`,
);

// The four seams, swapped at oracleSurface's import sites only. A name the test has not set on
// `globalThis.__v77lane2fakes` falls through to the real function.
const OVERRIDES = {
  "../core/compilerOracle": ["runOracleCheck"],
  "../core/coveringTestRun": ["runCoveringGroups"],
  "../core/testDiscovery": ["discoverCoveringTests"],
  "./callHierarchy": ["prepareCallRoot"],
};
const seamPlugin = {
  name: "v77-lane2-seams",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace !== "file" || !args.importer.endsWith(path.join("vscode", "oracleSurface.ts"))) {
        return undefined;
      }
      if (!(args.path in OVERRIDES)) {
        return undefined;
      }
      return { path: path.resolve(path.dirname(args.importer), `${args.path}.ts`), namespace: "v77-seam", pluginData: args.path };
    });
    build.onLoad({ filter: /.*/, namespace: "v77-seam" }, (args) => {
      const real = JSON.stringify(args.path);
      const names = OVERRIDES[args.pluginData];
      const lines = [`import * as real from ${real};`, `export * from ${real};`];
      for (const n of names) {
        lines.push(`export const ${n} = (...a) => (globalThis.__v77lane2fakes?.${n} ?? real.${n})(...a);`);
      }
      return { contents: lines.join("\n"), loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};

const entry = path.join(__dirname, ".impl-v77-p4-lane2.entry.ts");
const outfile = path.join(__dirname, ".impl-v77-p4-lane2.bundle.cjs");
fs.writeFileSync(entry, `export { runPostAcceptOracle } from "../src/vscode/oracleSurface";\n`);
// Plugins need the async build, so the bundle is made before the first row runs.
let runPostAcceptOracle;
let stubState;
test.before(async () => {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
    plugins: [seamPlugin],
    logLevel: "silent",
  });
  ({ runPostAcceptOracle } = require(outfile));
  stubState = globalThis.__v77lane2;
});

const core = bundleCore(
  "impl-v77-p4-lane2-core",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
const { RustOracle, runOracleCheck } = core.mod;

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p4-lane2-"));
test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
  core.cleanup();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

const SOURCE = "pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}\n";

/** A crate on disk, so the real `RustOracle.detectCrateRoot` finds its root. */
function crate(tag, withManifest = true) {
  const root = fs.mkdtempSync(path.join(SCRATCH, `${tag}-`));
  if (withManifest) fs.writeFileSync(path.join(root, "Cargo.toml"), '[package]\nname = "p"\nversion = "0.1.0"\n');
  fs.mkdirSync(path.join(root, "src"));
  const file = path.join(root, "src", "lib.rs");
  fs.writeFileSync(file, SOURCE);
  return { root, file };
}

function document(file) {
  let text = SOURCE;
  const positionAt = (offset) => {
    const before = text.slice(0, offset);
    return { offset, line: before.split("\n").length - 1, character: offset - before.lastIndexOf("\n") - 1 };
  };
  return {
    languageId: "rust",
    isDirty: false,
    isClosed: false,
    version: 1,
    uri: { fsPath: file, path: file, scheme: "file", toString: () => "file://" + file },
    getText: (range) => (range ? text.slice(range.start.offset, range.end.offset) : text),
    positionAt,
    offsetAt: (p) => p.offset,
    lineAt: (line) => {
      const t = text.split("\n")[line] ?? "";
      return { text: t, range: { start: { line, character: 0 }, end: { line, character: t.length } } };
    },
    save: async () => true,
  };
}

const resolved = () => ({
  span: { start: 0, end: SOURCE.length - 1 },
  signature: "pub fn add(a: i32, b: i32) -> i32",
  docComment: "",
  symbolName: "add",
  languageId: "rust",
  kind: "function",
  bodyOnly: false,
  headerIndent: "",
  headOffset: 0,
  bodyIndent: "    ",
});

const clean = (root) => ({ success: true, diagnostics: [], durationMs: 1, crateRoot: root });

/** One rustc error inside `add`, eligible for a compiler repair round. */
const brokenIn = (root, file) => ({
  success: false,
  durationMs: 1,
  crateRoot: root,
  diagnostics: [
    {
      kind: "compile-error",
      level: "error",
      code: "E0308",
      message: "mismatched types",
      suggestions: [],
      spans: [
        { fileName: file, byteStart: 40, byteEnd: 45, lineStart: 2, lineEnd: 2, columnStart: 5, columnEnd: 10, isPrimary: true },
      ],
    },
  ],
});

function rig(file, over = {}) {
  stubState.messages = [];
  stubState.config = { ...(over.config ?? {}) };
  const lines = [];
  const claims = [];
  const generateCalls = [];
  const presented = [];
  const ctx = {
    document: document(file),
    landedSpan: { start: 0, end: SOURCE.length - 1 },
    output: { appendLine: (l) => lines.push(String(l)), append() {} },
    service: {
      modelTag: "stub-model",
      generateRaw: async (...a) => {
        generateCalls.push(a);
        return over.reply === undefined ? undefined : { text: over.reply() };
      },
    },
    presenter: {
      present: async (p) => {
        presented.push(p);
        return over.verdict ?? "accept";
      },
    },
    resolveFunction: async () => resolved(),
    inFlight: {
      begin: (label) => {
        claims.push(label);
        return { release() {} };
      },
    },
    manualRefine: true,
    ...over.ctx,
  };
  return { ctx, lines, claims, generateCalls, presented, messages: () => stubState.messages };
}

const GROUP = (root) => ({
  key: `${root}::adds`,
  frameworkId: "cargo-test",
  tests: [{ filter: "adds", filePath: path.join(root, "src", "lib.rs") }],
  placement: { runRoot: root },
});

function covering(root, runs) {
  let call = 0;
  globalThis.__v77lane2fakes = {
    ...globalThis.__v77lane2fakes,
    prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
    discoverCoveringTests: async () => ({ groups: [GROUP(root)] }),
    runCoveringGroups: async () => runs[Math.min(call++, runs.length - 1)],
  };
}

const red = (root) => ({
  cancelled: false,
  outcomes: [
    {
      key: `${root}::adds`,
      frameworkName: "cargo test",
      tests: [{ filter: "adds" }],
      result: {
        ran: true,
        success: false,
        cases: [{ name: "adds", outcome: "fail" }],
        failures: [{ name: "adds", message: "assertion `left == right` failed\n  left: -1\n right: 3" }],
        passed: 0,
        failed: 1,
        ignored: 0,
        durationMs: 1,
        crateRoot: root,
      },
    },
  ],
});

test.afterEach(() => {
  globalThis.__v77lane2fakes = undefined;
});

// ---------------------------------------------------------------------------
// DE3, DF2: Rust says why its check could not run
// ---------------------------------------------------------------------------

test("DE3: RustOracle names the missing Cargo.toml, and a root that resolves has nothing to explain", () => {
  const oracle = new RustOracle({ fileExists: () => false });
  const why = oracle.describeMissingRoot("/w/x.rs");
  assert.match(why, /Cargo\.toml/);
  assert.match(why, /\/w\/x\.rs/);
  assert.equal(new RustOracle({ fileExists: (p) => p === "/w/Cargo.toml" }).describeMissingRoot("/w/x.rs"), undefined);
});

test("DF2: RustOracle describes a cargo that could not start, and one that failed with nothing to show", () => {
  const oracle = new RustOracle();
  const start = oracle.describeCheckFailure(-1, "spawn cargo ENOENT");
  assert.match(start, /^could not start cargo/);
  assert.match(start, /spawn cargo ENOENT/);
  assert.match(start, /Is Rust installed and on PATH\?/);
  assert.equal(
    oracle.describeCheckFailure(101, "   Compiling p v0.1.0"),
    "cargo check failed with no error to show; see the output channel",
    "a progress line is not quoted as the cause (M23)",
  );
});

test("DE3: Repair Function Body on a Rust file with no Cargo.toml says so on the status bar, once", async () => {
  const { file } = crate("noroot", false);
  const r = rig(file);
  await runPostAcceptOracle(r.ctx);
  const status = r.messages().filter((m) => m.kind === "status");
  assert.equal(status.length, 1, JSON.stringify(r.messages()));
  assert.match(status[0].message, /^Column 80: no Cargo\.toml above /);
});

// ---------------------------------------------------------------------------
// S77-12b, S77-12c: the spawn rejection's sentence
// ---------------------------------------------------------------------------

test("S77-12b/c: a check that could not spawn carries no Error: prefix and no doubled period", async () => {
  const { file } = crate("spawn");
  const reasons = [];
  const lines = [];
  const err = Object.assign(new Error("spawn go ENOENT."), { code: "ENOENT", syscall: "spawn go" });
  const goLike = new RustOracle();
  goLike.describeCheckFailure = (code, evidence) => `could not start go: ${evidence}. Is Go installed and on PATH?`;
  await assert.rejects(
    runOracleCheck(goLike, file, {
      log: (l) => lines.push(l),
      envReason: (r) => reasons.push(r),
      runCommand: async () => {
        throw err;
      },
    }),
  );
  assert.deepEqual(reasons, ["could not start go: spawn go ENOENT. Is Go installed and on PATH?"]);
  assert.ok(lines.some((l) => l === "[oracle] check failed: Error: spawn go ENOENT."), lines.join("\n"));
});

// ---------------------------------------------------------------------------
// DE14, DF32: a cancelled covering-test run does not start a refine
// ---------------------------------------------------------------------------

test("DE14: cancelling the covering-test run ends the press; no refine starts", async () => {
  const { root, file } = crate("cancel");
  const referencesCalls = [];
  globalThis.__v77lane2fakes = { runOracleCheck: async () => clean(root) };
  covering(root, [{ cancelled: true }]);
  const r = rig(file, {
    ctx: {
      extractor: {
        references: async (...a) => {
          referencesCalls.push(a);
          return [];
        },
      },
    },
  });
  await runPostAcceptOracle(r.ctx);
  assert.ok(r.lines.some((l) => l.includes("was cancelled")), r.lines.join("\n"));
  assert.equal(r.claims.filter((c) => /^Repairing/.test(c)).length, 0, JSON.stringify(r.claims));
  assert.equal(r.generateCalls.length, 0, "no model call after a cancel");
  assert.deepEqual(referencesCalls, [], "the refine's reference lookup never started");
  assert.equal(r.lines.filter((l) => l.startsWith("[repair] refine")).length, 0, r.lines.join("\n"));
  assert.deepEqual(r.messages(), [], "the user asked for the stop; nothing to report");
});

// ---------------------------------------------------------------------------
// DE18, DF34: a refusal before any diff was shown is not "after the repair rounds"
// ---------------------------------------------------------------------------

test("DE18: a round-1 reply naming code the surface does not have ends on a toast that says it was not shown", async () => {
  const { root, file } = crate("refused");
  globalThis.__v77lane2fakes = { runOracleCheck: async () => clean(root) };
  covering(root, [red(root)]);
  const r = rig(file, {
    reply: () => "pub fn add(a: i32, b: i32) -> i32 {\n    Mode::Fast as i32\n}",
    ctx: {
      extractor: {},
      resolveSpanSurface: async (_x, _d, _r, _log, opts) => {
        opts.onDisclosed([{ name: "Mode", members: ["Slow"], complete: true }]);
        return "API surface for `Mode`\nenum Mode { Slow }";
      },
    },
  });
  await runPostAcceptOracle(r.ctx);
  assert.equal(r.generateCalls.length, 1, r.lines.join("\n"));
  assert.equal(r.presented.length, 0, "the refused reply never reached a diff");
  const warns = r.messages().filter((m) => m.kind === "warn");
  assert.equal(warns.length, 1, JSON.stringify(r.messages()));
  assert.ok(!warns[0].message.includes("after the repair rounds"), warns[0].message);
  assert.equal(
    warns[0].message,
    "Column 80: 1 covering test for add still fails. The proposed repair called code Column 80 could not find, so it was not shown. See the output channel.",
  );
});

// ---------------------------------------------------------------------------
// S77-26 #9 (DF30, DE5): a press that spent its compiler round says the tests are next
// ---------------------------------------------------------------------------

test("DF30: a press whose compiler round fixed the build says to press again for the covering tests", async () => {
  const { root, file } = crate("round");
  const checks = [brokenIn(root, file), clean(root)];
  let n = 0;
  globalThis.__v77lane2fakes = { runOracleCheck: async () => checks[Math.min(n++, checks.length - 1)] };
  const r = rig(file, { reply: () => "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}" });
  await runPostAcceptOracle(r.ctx);
  assert.equal(r.presented.length, 1, r.lines.join("\n"));
  const status = r.messages().filter((m) => m.kind === "status");
  assert.deepEqual(
    status.map((m) => m.message),
    ['Column 80: the build is fixed. Run "Column 80: Repair Function Body" again to run its covering tests.'],
    r.lines.join("\n"),
  );
  assert.equal(r.messages().filter((m) => m.kind !== "status").length, 0, JSON.stringify(r.messages()));
});
