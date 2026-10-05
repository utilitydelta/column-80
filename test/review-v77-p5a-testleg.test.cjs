"use strict";

// REVIEW evidence, session-v77 phase 5 part A (session-v77/review-p5a.md), finding P5A-1.
//
// Phase 2 loop 2 (L7) wrapped the test leg's repair loop in
// `try { ... } catch (e) { flushBroke(); throw e; }`. A press whose round 1 broke a passing
// test and whose round 2 then throws (the save before the re-run fails) shows the held
// "broke" sentence as its own warning AND rejects with an error that fnGen's Repair Function
// Body catch turns into a second warning ("Repair Function Body stopped (...)"; that half is
// pinned by impl-v77-p4-lane1 "NF3 control"). R15: one press, one toast.
//
// Bound to what the user sees: one press ends on exactly one warning, and that warning carries
// both the "broke" sentence and the save failure. Re-bound in phase 5 integration: the first
// version also required the leg to reject with /could not save/, which the fix (end the press
// on one folded warning and return) cannot satisfy. Red against the pre-fix leg (checked on a
// scratch copy with the flushBroke-then-throw path restored): 1 warning plus fnGen's stop toast.
//
// The harness is impl-v77-p4-lane2's: runPostAcceptOracle bundled for real, with the check,
// discovery, the covering run and the call-hierarchy anchor faked at oracleSurface's imports.
//
// Run: node --test test/review-v77-p5a-testleg.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const STUB = path.join(__dirname, ".review-v77-p5a-testleg-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v77p5a = globalThis.__v77p5a || { messages: [], config: {} });
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
// `globalThis.__v77p5afakes` falls through to the real function.
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
        lines.push(`export const ${n} = (...a) => (globalThis.__v77p5afakes?.${n} ?? real.${n})(...a);`);
      }
      return { contents: lines.join("\n"), loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};

const entry = path.join(__dirname, ".review-v77-p5a-testleg.entry.ts");
const outfile = path.join(__dirname, ".review-v77-p5a-testleg.bundle.cjs");
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
  stubState = globalThis.__v77p5a;
});

const core = bundleCore(
  "review-v77-p5a-testleg-core",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
const { RustOracle, runOracleCheck } = core.mod;

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "review-v77-p5a-testleg-"));
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
  globalThis.__v77p5afakes = {
    ...globalThis.__v77p5afakes,
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
  globalThis.__v77p5afakes = undefined;
});

const result = (root, cases) => ({
  cancelled: false,
  outcomes: [
    {
      key: `${root}::adds`,
      frameworkName: "cargo test",
      tests: [{ filter: "adds" }, { filter: "subs" }, { filter: "muls" }, { filter: "keeps" }],
      result: {
        ran: true,
        success: cases.every((c) => c.outcome === "pass"),
        cases,
        failures: cases
          .filter((c) => c.outcome === "fail")
          .map((c) => ({ name: c.name, message: "assertion `left == right` failed\n  left: -1\n right: 3" })),
        passed: cases.filter((c) => c.outcome === "pass").length,
        failed: cases.filter((c) => c.outcome === "fail").length,
        ignored: 0,
        durationMs: 1,
        crateRoot: root,
      },
    },
  ],
});

test("P5A-1: round 1 broke a test, round 2's save fails: the press must not end on two warnings", async () => {
  const { root, file } = crate("broke-then-throw");
  globalThis.__v77p5afakes = {
    runOracleCheck: async () => clean(root),
    prepareCallRoot: async () => ({ uri: "file:///x", name: "add" }),
    discoverCoveringTests: async () => ({
      groups: [
        {
          key: `${root}::adds`,
          frameworkId: "cargo-test",
          tests: ["adds", "subs", "muls", "keeps"].map((filter) => ({ filter, filePath: path.join(root, "src", "lib.rs") })),
          placement: { runRoot: root },
        },
      ],
    }),
  };
  const runs = [
    // Before: three red, keeps green.
    result(root, [
      { name: "adds", outcome: "fail" },
      { name: "subs", outcome: "fail" },
      { name: "muls", outcome: "fail" },
      { name: "keeps", outcome: "pass" },
    ]),
    // After round 1: two fixed, keeps broken. Red falls 3 -> 2, so round 2 runs.
    result(root, [
      { name: "adds", outcome: "pass" },
      { name: "subs", outcome: "pass" },
      { name: "muls", outcome: "fail" },
      { name: "keeps", outcome: "fail" },
    ]),
  ];
  let call = 0;
  globalThis.__v77p5afakes.runCoveringGroups = async () => runs[Math.min(call++, runs.length - 1)];

  const r = rig(file, { reply: () => "pub fn add(a: i32, b: i32) -> i32 {\n    a * b\n}" });
  // The second accepted diff leaves the buffer dirty and the save fails.
  let presents = 0;
  r.ctx.presenter = {
    present: async (p) => {
      r.presented.push(p);
      presents++;
      return "accept";
    },
  };
  Object.defineProperty(r.ctx.document, "isDirty", { get: () => presents >= 2 });
  r.ctx.document.save = async () => false;

  let rejected;
  try {
    await runPostAcceptOracle(r.ctx);
  } catch (err) {
    rejected = err;
  }
  assert.equal(r.presented.length, 2, `precondition: two rounds reached a diff.\n${r.lines.join("\n")}`);
  const warns = r.messages().filter((m) => m.kind === "warn");
  // fnGen's Repair Function Body catch toasts every rejection that is not a cancellation and not
  // marked as already shown (`shownToUser`, set by `markShown` in compilerOracle.ts;
  // impl-v77-p4-lane1 "NF3 control" pins that toast). Count it as part of this press.
  const fnGenWillToast =
    rejected !== undefined && rejected?.name !== "AbortError" && rejected?.shownToUser !== true;
  const toastsForThePress = warns.length + (fnGenWillToast ? 1 : 0);
  assert.equal(
    toastsForThePress,
    1,
    `one press, one toast (R15). The leg showed ${warns.length}` +
      (fnGenWillToast ? ` and then threw an error fnGen also toasts: Repair Function Body stopped (${rejected.message})` : "") +
      `:\n${JSON.stringify(warns.map((w) => w.message))}`,
  );
  // The one warning carries both facts: round 1 broke a test that passed, and the save failed,
  // so the tests were not re-run.
  assert.match(warns[0].message, /broke 1 test/, "the one warning must say round 1 broke a test");
  assert.match(warns[0].message, /could not save/i, "the one warning must say the save failed");
});
