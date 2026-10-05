"use strict";

// session-v77 phase 5, lane 2 (repair and the test leg).
//
//   P5A-1  a test-leg press whose round 1 broke a test ends on ONE message, whatever ends it:
//          a failed save, any other throw, or a cancel
//   P5A-5  a check that put its status bar line up marks its rejection, so the Repair Function
//          Body catch keys on "the user was told", not on the error's shape
//
// The harness is review-v77-p5a-testleg's: runPostAcceptOracle bundled for real, with the check,
// discovery, the covering run and the call-hierarchy anchor faked at oracleSurface's imports.
//
// Run: node --test test/impl-v77-p5-lane2.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

const STUB = path.join(__dirname, ".impl-v77-p5-lane2-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__v77p5l2 = globalThis.__v77p5l2 || { messages: [], config: {} });
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
// `globalThis.__v77p5l2fakes` falls through to the real function.
const OVERRIDES = {
  "../core/compilerOracle": ["runOracleCheck"],
  "../core/coveringTestRun": ["runCoveringGroups"],
  "../core/testDiscovery": ["discoverCoveringTests"],
  "./callHierarchy": ["prepareCallRoot"],
};
const seamPlugin = {
  name: "v77-p5-lane2-seams",
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
        lines.push(`export const ${n} = (...a) => (globalThis.__v77p5l2fakes?.${n} ?? real.${n})(...a);`);
      }
      return { contents: lines.join("\n"), loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};

const entry = path.join(__dirname, ".impl-v77-p5-lane2.entry.ts");
const outfile = path.join(__dirname, ".impl-v77-p5-lane2.bundle.cjs");
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
  stubState = globalThis.__v77p5l2;
});

const core = bundleCore(
  "impl-v77-p5-lane2-core",
  `export { RustOracle, runOracleCheck } from "../src/core/compilerOracle";\n`,
);
const { RustOracle, runOracleCheck } = core.mod;

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v77-p5-lane2-"));
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
  globalThis.__v77p5l2fakes = {
    ...globalThis.__v77p5l2fakes,
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
  globalThis.__v77p5l2fakes = undefined;
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

// The P5A-1 rig: four covering tests, three red and `keeps` green. Round 1 fixes two and breaks
// `keeps`, so red falls 3 -> 2 and round 2 reaches its own diff. `round2` decides how round 2 ends.
function brokeThenRound2(tag, round2) {
  const { root, file } = crate(tag);
  globalThis.__v77p5l2fakes = {
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
    result(root, [
      { name: "adds", outcome: "fail" },
      { name: "subs", outcome: "fail" },
      { name: "muls", outcome: "fail" },
      { name: "keeps", outcome: "pass" },
    ]),
    result(root, [
      { name: "adds", outcome: "pass" },
      { name: "subs", outcome: "pass" },
      { name: "muls", outcome: "fail" },
      { name: "keeps", outcome: "fail" },
    ]),
  ];
  let call = 0;
  globalThis.__v77p5l2fakes.runCoveringGroups = async () => runs[Math.min(call++, runs.length - 1)];
  const r = rig(file, { reply: () => "pub fn add(a: i32, b: i32) -> i32 {\n    a * b\n}" });
  let presents = 0;
  r.ctx.presenter = {
    present: async (p) => {
      r.presented.push(p);
      presents++;
      if (presents >= 2 && round2.present) return round2.present();
      return "accept";
    },
  };
  if (round2.saveFails) {
    Object.defineProperty(r.ctx.document, "isDirty", { get: () => presents >= 2 });
    r.ctx.document.save = async () => false;
  }
  return r;
}

async function press(r) {
  try {
    await runPostAcceptOracle(r.ctx);
    return undefined;
  } catch (err) {
    return err;
  }
}

// What fnGen's Repair Function Body catch does with a rejection: toast unless it is a
// cancellation or the user was already told. Mirrors fnGen.ts; the fnGen half is pinned by
// impl-v77-p4-lane1 "NF3" rows.
const fnGenToasts = (err) => err !== undefined && err.name !== "AbortError" && err.shownToUser !== true;

const BROKE = /the repair of add broke 1 test that passed before \(keeps\)/;

test("P5A-1: a failed save after a round that broke a test ends the press on one warning carrying both", async () => {
  const r = brokeThenRound2("save", { saveFails: true });
  const rejected = await press(r);
  assert.equal(r.presented.length, 2, r.lines.join("\n"));
  const warns = r.messages().filter((m) => m.kind === "warn").map((m) => m.message);
  assert.equal(warns.length + (fnGenToasts(rejected) ? 1 : 0), 1, `${JSON.stringify(warns)}\nrejected: ${String(rejected)}`);
  assert.match(warns[0], BROKE);
  assert.match(warns[0], /Could not save .*lib\.rs, so the covering tests were not re-run\.$/);
});

test("P5A-1: any other throw after a broke round is one warning, and the rejection is marked shown", async () => {
  const r = brokeThenRound2("throw", {
    present: () => {
      throw new Error("the diff editor went away\nsecond line");
    },
  });
  const rejected = await press(r);
  const warns = r.messages().filter((m) => m.kind === "warn").map((m) => m.message);
  assert.ok(rejected instanceof Error, String(rejected));
  assert.equal(rejected.shownToUser, true, "fnGen's catch must not toast this stop again");
  assert.equal(warns.length + (fnGenToasts(rejected) ? 1 : 0), 1, JSON.stringify(warns));
  assert.match(warns[0], BROKE);
  assert.match(warns[0], /Repair Function Body stopped \(the diff editor went away\)\. The full message is in the output channel\.$/);
});

test("P5A-1 control: a cancel after a broke round shows the held sentence alone and stays a cancellation", async () => {
  const r = brokeThenRound2("cancel", {
    present: () => {
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  });
  const rejected = await press(r);
  const warns = r.messages().filter((m) => m.kind === "warn").map((m) => m.message);
  assert.equal(rejected?.name, "AbortError");
  assert.notEqual(rejected.shownToUser, true);
  assert.equal(warns.length, 1, JSON.stringify(warns));
  assert.match(warns[0], BROKE);
  assert.doesNotMatch(warns[0], /stopped/);
});

// ---------------------------------------------------------------------------
// P5A-5: the mark is set where the status bar line goes up, and only there.
// ---------------------------------------------------------------------------

test("P5A-5: runOracleCheck marks a spawn rejection only when it put the reason on screen", async () => {
  const { file } = crate("mark");
  const spawnReject = async () => {
    throw Object.assign(new Error("spawn cargo ENOENT"), { code: "ENOENT", syscall: "spawn cargo" });
  };
  const rows = [
    { name: "with envReason", opts: (shown) => ({ runCommand: spawnReject, envReason: (r) => shown.push(r) }), marked: true },
    { name: "without envReason", opts: () => ({ runCommand: spawnReject }), marked: false },
  ];
  for (const row of rows) {
    const shown = [];
    let err;
    try {
      await runOracleCheck(new RustOracle(), file, row.opts(shown));
    } catch (e) {
      err = e;
    }
    assert.equal(err?.syscall, "spawn cargo", `${row.name}: the original error is rethrown`);
    assert.equal(err.shownToUser === true, row.marked, `${row.name}: marked`);
    assert.equal(shown.length, row.marked ? 1 : 0, `${row.name}: reasons shown`);
  }
});
