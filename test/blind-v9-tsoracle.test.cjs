// Blind oracle: the TS compiler oracle (the v9 phase 2 surface).
// Black-box contract tests written from the surface ALONE, before the impl
// exists. Covers every phase-2 section:
//   Construction    TsOracle deps, language === "typescript"
//   appliesTo       the four TS/JS ids true, vue/svelte/rust/etc false
//   detectCrateRoot nearest tsconfig + version honesty (project-local tsc)
//   buildCheckCommand  process.execPath + resolved tsc + --noEmit --pretty false -p
//                      with env ELECTRON_RUN_AS_NODE=1 (post-review amendment)
//   Coverage probe  --listFilesOnly before the first check of a (root, file):
//                   probe-first ordering, fail-open on a diagnostic answer and
//                   on a rejecting spawn, positive caching. The not-covered arm
//                   is AMENDED to the 4B coverage fallback (phase4-surface.md):
//                   referenced projects and sibling tsconfig.*.json get probed
//                   before honest dark; covered-by-nothing keeps the skip
//   parseCheckOutput   real tsc --pretty false fixtures: codes, levels, spans,
//                      byte-offset conversion (multibyte + unreadable -1),
//                      continuation joining, global span-less, garbage, rendered
//   checkSuccess    exitCode === 0, stdout ignored
//   resolveDiagnosticPath  absolute passthrough, crateRoot join, NO anchor walk
//   isAssertionShaped      kind-only; rustc-shaped TEXT stays un-refused
//   Test rung       both methods absent; runTestOracle skips with a log line
//   oracleFor       registration matrix + deps passthrough
//   Repair integration     classifyEligibility hook, RepairScope.resolvePath,
//                          RepairSession reaching kind "repair"
// Never read src/**. Expected RED: `TsOracle` does not exist yet. The bundle
// may fail outright, or build with the export missing (esbuild treats an
// unresolved TS re-export as a possible type and elides it). The guard below
// keeps either red informative: one failing surface test, the rest skip;
// once the impl lands everything runs.
//
// Run: SKIP_LIVE=1 node --test test/blind-v9-tsoracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v9-tsoracle",
    `export { TsOracle, oracleFor, runOracleCheck, runTestOracle } from "../src/core/compilerOracle";\n` +
    `export { classifyEligibility, RepairSession } from "../src/core/repair";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.TsOracle !== "function") {
  bundleError = new Error("the bundle built but exports no TsOracle class");
}
test.after(() => cleanup());

const { TsOracle, oracleFor, runOracleCheck, runTestOracle, classifyEligibility, RepairSession } = mod;

test("bundle: the v9 tsoracle surface builds (TsOracle exported from compilerOracle) [surface: Test harness 'same bundleCore pattern']", () => {
  if (bundleError) {
    assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red
// run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fixtures: REAL tsc output, captured once with typescript 5.9.3 (this repo's
// own node_modules/typescript devDependency) by scaffolding throwaway projects
// and running
//   node node_modules/typescript/bin/tsc --noEmit --pretty false -p <dir>
// with cwd = the project dir (the exact shape buildCheckCommand pins), then
// embedding stdout verbatim. NO tsc runs inside these tests. Constants marked
// DERIVED are hand-written variants for the garbage/robustness clauses only.
// ---------------------------------------------------------------------------

// clean project: stdout was empty, exit 0.
const TSC_CLEAN = "";

// src/app.ts: `const label: string = "task";` / `const count: number = label;`
// exit 2.
const TSC_TYPE_ERROR =
  "src/app.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const TYPE_ERROR_SRC =
  'const label: string = "task";\nconst count: number = label;\nexport { count };\n';

// src/app.ts: `import { helper } from "./missing";` - exit 2.
const TSC_UNRESOLVED_IMPORT =
  "src/app.ts(1,24): error TS2307: Cannot find module './missing' or its corresponding type declarations.\n";
const UNRESOLVED_IMPORT_SRC =
  'import { helper } from "./missing";\nexport const v = helper;\n';

// Multi-line elaboration: `const raw = { x: 1, y: "two" };` assigned to a
// Point-typed const. Continuation lines are space-indented. exit 2.
const TSC_ELABORATED =
  "src/app.ts(3,7): error TS2322: Type '{ x: number; y: string; }' is not assignable to type 'Point'.\n" +
  "  Types of property 'y' are incompatible.\n" +
  "    Type 'string' is not assignable to type 'number'.\n";
const ELABORATED_SRC =
  "interface Point { x: number; y: number }\n" +
  'const raw = { x: 1, y: "two" };\n' +
  "const p: Point = raw;\n" +
  "export { p };\n";

// Global config-level error: tsconfig with "include": [] and no files. No
// file(line,col) prefix. exit 2. The config path is part of the captured text.
const TSC_GLOBAL =
  "error TS18003: No inputs were found in config file '/tmp/claude-1000/-home-utilitydelta-work-utilitydelta-column-80/714a7929-288a-40a6-aaa4-15b973b13219/scratchpad/tsfix/global/tsconfig.json'. Specified 'include' paths were '[]' and 'exclude' paths were '[]'.\n";

// Two errors in one file (real capture, one project): checks per-parse-call
// readFile caching and per-span conversion. exit 2.
const TSC_TWO_ERRORS =
  "src/app.ts(2,26): error TS2322: Type 'string' is not assignable to type 'number'.\n" +
  "src/app.ts(3,50): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const TWO_ERRORS_SRC =
  "interface Point { x: number; y: number }\n" +
  'const p: Point = { x: 1, y: "two" };\n' +
  'const q: { deep: { value: number } } = { deep: { value: "nested" } };\n' +
  "export { p, q };\n";

// Multibyte: an emoji (4 UTF-8 bytes, 2 UTF-16 units) sits before the error
// column. tsc reported (1,17) - columns count UTF-16 code units. exit 2.
const TSC_MULTIBYTE =
  "src/app.ts(1,17): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const MULTIBYTE_SRC = 'const s = "\u{1F600}", n: number = s;\nexport { n };\n';

// DERIVED: the real type-error line wrapped in unparseable noise.
const TSC_WITH_GARBAGE =
  "npm warn config production Use `--omit=dev` instead.\n" +
  "}{ totally not a diagnostic line\n" +
  TSC_TYPE_ERROR +
  "banner text without any TS code\n";

// DERIVED: an indented stray line with NO open diagnostic above it.
const TSC_LEADING_INDENT =
  "  stray indented line with no diagnostic above\n" + TSC_TYPE_ERROR;

// DERIVED: the real line with error swapped for warning (robustness clause).
const TSC_WARNING =
  "src/app.ts(2,7): warning TS2322: Type 'string' is not assignable to type 'number'.\n";

// DERIVED: a located diagnostic naming an absolute path that cannot exist.
const TSC_UNREADABLE =
  "/nope/blind-v9-missing.ts(3,9): error TS2304: Cannot find name 'zzz'.\n";

// ---------------------------------------------------------------------------
// Shared fixtures. No real filesystem: fileExists/readFile always injected.
// ---------------------------------------------------------------------------

// Virtual filesystem: true only for the exact paths given.
const existsIn = (paths) => (p) => paths.includes(p);

// Single project with a local typescript install.
const PROJ = "/proj";
const PROJ_FS = existsIn(["/proj/tsconfig.json", "/proj/node_modules/typescript/bin/tsc"]);

// Monorepo: tsconfig per package, typescript hoisted to the repo root.
const MONO_FS = existsIn([
  "/mono/tsconfig.json",
  "/mono/packages/app/tsconfig.json",
  "/mono/node_modules/typescript/bin/tsc",
]);

// tsconfig present, typescript never installed (fresh clone).
const BARE_FS = existsIn(["/bare/tsconfig.json"]);

// readFile stub over a { printedPath: content } map, recording calls.
const readerFor = (files) => {
  const calls = [];
  const readFile = (p) => {
    calls.push(p);
    return files[p];
  };
  return { readFile, calls };
};

// ===========================================================================
// Construction. [surface: 'Construction']
// ===========================================================================

gtest("construction: TsOracle takes optional deps and pins language 'typescript' [surface: 'Construction']", () => {
  const bare = new TsOracle();
  assert.strictEqual(bare.language, "typescript", "language is the readonly literal 'typescript'");
  const injected = new TsOracle({ fileExists: PROJ_FS, readFile: () => undefined, log: () => {} });
  assert.strictEqual(injected.language, "typescript");
});

gtest("construction: TsOracle carries every required strategy method, and NO rung [surface: 'Construction' + 'Test rung']", () => {
  const oracle = new TsOracle();
  for (const m of ["appliesTo", "detectCrateRoot", "buildCheckCommand", "parseCheckOutput", "checkSuccess", "resolveDiagnosticPath", "isAssertionShaped"]) {
    assert.strictEqual(typeof oracle[m], "function", `required strategy method: ${m}`);
  }
  assert.strictEqual(oracle.buildTestCommand, undefined, "no TS test rung: buildTestCommand absent");
  assert.strictEqual(oracle.parseTestOutput, undefined, "no TS test rung: parseTestOutput absent");
});

// ===========================================================================
// appliesTo. [surface: 'appliesTo']
// ===========================================================================

gtest("appliesTo: true for exactly the four TS/JS ids, false for everything else [surface: 'appliesTo']", () => {
  const oracle = new TsOracle();
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    assert.strictEqual(oracle.appliesTo(id), true, `appliesTo(${JSON.stringify(id)}) is true`);
  }
  for (const id of ["vue", "svelte", "rust", "python", "plaintext", "", "TypeScript", "ts"]) {
    assert.strictEqual(oracle.appliesTo(id), false, `appliesTo(${JSON.stringify(id)}) is false`);
  }
});

// ===========================================================================
// detectCrateRoot. [surface: 'detectCrateRoot(filePath)']
// ===========================================================================

gtest("detectCrateRoot: nearest tsconfig.json wins - monorepo package scopes the check [surface: 'detectCrateRoot' 'nearest wins, exactly the Cargo.toml discipline']", () => {
  const oracle = new TsOracle({ fileExists: MONO_FS });
  assert.strictEqual(
    oracle.detectCrateRoot("/mono/packages/app/src/index.ts"),
    "/mono/packages/app",
    "the package tsconfig is nearer than the repo-root one"
  );
  assert.strictEqual(
    oracle.detectCrateRoot("/mono/tools/script.ts"),
    "/mono",
    "outside the package, the repo-root tsconfig is the nearest"
  );
});

gtest("detectCrateRoot: hoisted monorepo typescript resolves - the ancestor walk finds node_modules/typescript/bin/tsc at the repo root [surface: 'detectCrateRoot' 'hoisted monorepo installs resolve at the repo root']", () => {
  const oracle = new TsOracle({ fileExists: MONO_FS });
  // /mono/packages/app has NO node_modules of its own; only /mono does.
  assert.strictEqual(oracle.detectCrateRoot("/mono/packages/app/src/index.ts"), "/mono/packages/app");
});

gtest("detectCrateRoot: version honesty - tsconfig without any project-local typescript is undefined [surface: 'detectCrateRoot' 'the oracle is silently inapplicable']", () => {
  const oracle = new TsOracle({ fileExists: BARE_FS });
  assert.strictEqual(
    oracle.detectCrateRoot("/bare/src/index.ts"),
    undefined,
    "fresh clone (tsconfig, no install): never fall back to a bundled/global tsc"
  );
});

gtest("detectCrateRoot: no tsconfig anywhere up is undefined [surface: 'detectCrateRoot' - the missing-Cargo.toml analogue]", () => {
  const oracle = new TsOracle({ fileExists: PROJ_FS });
  assert.strictEqual(oracle.detectCrateRoot("/elsewhere/src/index.ts"), undefined);
});

gtest("detectCrateRoot: injected fileExists is the only filesystem touched [surface: 'Construction' deps + 'detectCrateRoot']", () => {
  const oracle = new TsOracle({ fileExists: PROJ_FS });
  assert.strictEqual(oracle.detectCrateRoot("/proj/src/deep/nested/file.ts"), PROJ, "a fake project resolves without disk");
  assert.strictEqual(oracle.detectCrateRoot("/proj/index.ts"), PROJ, "a file directly in the root dir resolves too");
});

// ===========================================================================
// buildCheckCommand. [surface: 'buildCheckCommand(crateRoot)']
// ===========================================================================

gtest("buildCheckCommand: host's own node (process.execPath) + resolved local tsc + --noEmit --pretty false -p, cwd crateRoot, ELECTRON_RUN_AS_NODE env [surface: 'buildCheckCommand' (amended)]", () => {
  const oracle = new TsOracle({ fileExists: PROJ_FS });
  assert.deepStrictEqual(oracle.buildCheckCommand(PROJ), {
    command: process.execPath,
    args: ["/proj/node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "-p", PROJ],
    cwd: PROJ,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
});

gtest("buildCheckCommand: the tsc path is the walk-up resolution - hoisted install lands on the repo root's tsc [surface: 'buildCheckCommand' 'the same walk-up resolution detectCrateRoot performed']", () => {
  const oracle = new TsOracle({ fileExists: MONO_FS });
  const cmd = oracle.buildCheckCommand("/mono/packages/app");
  assert.strictEqual(cmd.command, process.execPath, "the HOST'S OWN node - never PATH lookup, never a .bin shim, never npx");
  assert.deepStrictEqual(
    cmd.args,
    ["/mono/node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "-p", "/mono/packages/app"],
    "tsc resolved at /mono, project flag stays the package root"
  );
  assert.strictEqual(cmd.cwd, "/mono/packages/app");
  assert.deepStrictEqual(cmd.env, { ELECTRON_RUN_AS_NODE: "1" }, "inert under plain node, electron-as-node in the extension host");
});

gtest("buildCoverageCommand: execPath + resolved tsc + --listFilesOnly -p, same cwd/env shape as the check [surface: 'Coverage probe' strategy pair]", () => {
  const oracle = new TsOracle({ fileExists: MONO_FS });
  assert.deepStrictEqual(oracle.buildCoverageCommand("/mono/packages/app"), {
    command: process.execPath,
    args: ["/mono/node_modules/typescript/bin/tsc", "--listFilesOnly", "-p", "/mono/packages/app"],
    cwd: "/mono/packages/app",
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
});

// ===========================================================================
// parseCheckOutput. [surface: 'parseCheckOutput(stdout)']
// ===========================================================================

gtest("parse: empty stdout (clean run) yields [] [surface: 'parseCheckOutput' clause 4 'Empty stdout yields []']", () => {
  const oracle = new TsOracle({ readFile: () => undefined });
  assert.deepStrictEqual(oracle.parseCheckOutput(TSC_CLEAN), []);
});

gtest("parse: a located type error maps code/kind/level/span exactly [surface: 'parseCheckOutput' clause 1]", () => {
  const { readFile, calls } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_TYPE_ERROR);
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error");
  assert.strictEqual(d.level, "error");
  assert.strictEqual(d.code, "TS2322", "the TS-prefixed code, per scout finding 4");
  assert.strictEqual(d.message, "Type 'string' is not assignable to type 'number'.");
  assert.deepStrictEqual(d.suggestions, [], "tsc text carries no machine-applicable fixes");
  assert.strictEqual(d.rendered.trimEnd(), TSC_TYPE_ERROR.trimEnd(), "rendered is the exact original header line");

  assert.strictEqual(d.spans.length, 1, "one span per located diagnostic");
  const s = d.spans[0];
  assert.strictEqual(s.fileName, "src/app.ts", "file path AS PRINTED (relative)");
  assert.strictEqual(s.isPrimary, true);
  assert.strictEqual(s.lineStart, 2);
  assert.strictEqual(s.lineEnd, 2);
  assert.strictEqual(s.columnStart, 7);
  assert.strictEqual(s.columnEnd, 7);
  // byte offset: line 1 (29 bytes + \n) + 6 units of "const " = 36.
  assert.strictEqual(s.byteStart, 36, "UTF-8 byte prefix up to (line-1) lines + (col-1) UTF-16 units");
  assert.strictEqual(s.byteEnd, 36, "tsc text has no end position: zero-width span");
  assert.ok(calls.includes("src/app.ts"), "readFile was asked for the path as printed");
});

gtest("parse: an unresolved import is a plain TS2307 compile error [surface: 'Fixtures' 'an unresolved import (TS2307)']", () => {
  const { readFile } = readerFor({ "src/app.ts": UNRESOLVED_IMPORT_SRC });
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_UNRESOLVED_IMPORT);
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error");
  assert.strictEqual(d.code, "TS2307");
  assert.strictEqual(d.message, "Cannot find module './missing' or its corresponding type declarations.");
  const s = d.spans[0];
  assert.strictEqual(s.lineStart, 1);
  assert.strictEqual(s.columnStart, 24);
  // 23 single-byte chars of `import { helper } from ` precede col 24.
  assert.strictEqual(s.byteStart, 23);
  assert.strictEqual(s.byteEnd, 23);
});

gtest("parse: continuation lines join the message and the rendered block [surface: 'parseCheckOutput' clauses 2 + 5]", () => {
  const { readFile } = readerFor({ "src/app.ts": ELABORATED_SRC });
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_ELABORATED);
  assert.strictEqual(diags.length, 1, "the elaboration is ONE diagnostic, not three");
  const d = diags[0];
  assert.strictEqual(d.code, "TS2322");

  const parts = d.message.split("\n");
  assert.strictEqual(parts.length, 3, "message is newline-joined: header + two continuation lines");
  assert.strictEqual(parts[0], "Type '{ x: number; y: string; }' is not assignable to type 'Point'.");
  assert.ok(parts[1].includes("Types of property 'y' are incompatible."), `continuation 1 appended, got ${JSON.stringify(parts[1])}`);
  assert.ok(parts[2].includes("Type 'string' is not assignable to type 'number'."), `continuation 2 appended, got ${JSON.stringify(parts[2])}`);

  assert.strictEqual(d.rendered.trimEnd(), TSC_ELABORATED.trimEnd(), "rendered is the full original block, indentation intact - the exact text a human saw");

  const s = d.spans[0];
  assert.strictEqual(s.lineStart, 3);
  assert.strictEqual(s.columnStart, 7);
  assert.strictEqual(s.byteStart, 79, "lines 1-2 (40+1 + 31+1 bytes) + 6 units of 'const '");
});

gtest("parse: a global config error has spans: [] [surface: 'parseCheckOutput' clause 3]", () => {
  const { readFile, calls } = readerFor({});
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_GLOBAL);
  assert.strictEqual(diags.length, 1);
  const d = diags[0];
  assert.strictEqual(d.kind, "compile-error");
  assert.strictEqual(d.level, "error");
  assert.strictEqual(d.code, "TS18003");
  assert.ok(d.message.includes("No inputs were found in config file"), `the message text survives, got ${JSON.stringify(d.message)}`);
  assert.deepStrictEqual(d.spans, [], "file-less diagnostic: no spans");
  assert.strictEqual(calls.length, 0, "no located file, so nothing to read");
});

gtest("parse: multibyte content - byte offsets count UTF-8 bytes over a UTF-16 column slice [surface: 'parseCheckOutput' 'Spans and byte offsets']", () => {
  const { readFile } = readerFor({ "src/app.ts": MULTIBYTE_SRC });
  const oracle = new TsOracle({ readFile });
  const [d] = oracle.parseCheckOutput(TSC_MULTIBYTE);
  const s = d.spans[0];
  assert.strictEqual(s.lineStart, 1);
  assert.strictEqual(s.columnStart, 17, "tsc's column counts the emoji as 2 UTF-16 units");
  // First 16 UTF-16 units of the line are `const s = "` (11 bytes) + emoji
  // (4 bytes) + `", ` (3 bytes) = 18 UTF-8 bytes. Same rule as byteScope.
  assert.strictEqual(s.byteStart, 18, "the emoji is 4 UTF-8 bytes, not 2");
  assert.strictEqual(s.byteEnd, 18);
  assert.notStrictEqual(s.byteStart, 16, "naive col-1 arithmetic (UTF-16 units as bytes) would be wrong here");
});

gtest("parse: an unreadable file keeps line/col, sets byteStart=byteEnd=-1, and logs the skip [surface: 'parseCheckOutput' 'When the file cannot be read']", () => {
  const lines = [];
  const oracle = new TsOracle({ readFile: () => undefined, log: (l) => lines.push(l) });
  const [d] = oracle.parseCheckOutput(TSC_UNREADABLE);
  assert.strictEqual(d.code, "TS2304");
  const s = d.spans[0];
  assert.strictEqual(s.fileName, "/nope/blind-v9-missing.ts", "absolute path as printed");
  assert.strictEqual(s.lineStart, 3, "line/col are kept");
  assert.strictEqual(s.columnStart, 9);
  assert.strictEqual(s.byteStart, -1, "-1 can never test inside any repair scope: refuse-repair wins");
  assert.strictEqual(s.byteEnd, -1);
  assert.ok(lines.length > 0, "the skip is logged when a log fn is present");
});

gtest("parse: garbage lines between diagnostics are skipped, never thrown on [surface: 'parseCheckOutput' clause 4]", () => {
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ readFile });
  assert.doesNotThrow(() => oracle.parseCheckOutput(TSC_WITH_GARBAGE));
  const diags = oracle.parseCheckOutput(TSC_WITH_GARBAGE);
  assert.strictEqual(diags.length, 1, "exactly the one real diagnostic survives the noise");
  assert.strictEqual(diags[0].code, "TS2322");
  assert.ok(!diags[0].message.includes("npm warn"), "leading garbage never leaks into the message");
  assert.ok(!diags[0].message.includes("banner text"), "an UNindented trailing line is not a continuation");
  assert.deepStrictEqual(oracle.parseCheckOutput("pure garbage\n}{ broken\n"), [], "all-garbage stdout yields []");
});

gtest("parse: an indented line with no open diagnostic above it is garbage, not a continuation [surface: 'parseCheckOutput' clauses 2 + 4]", () => {
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_LEADING_INDENT);
  assert.strictEqual(diags.length, 1);
  assert.ok(!diags[0].message.includes("stray indented"), "nothing to append to: the stray line is skipped");
});

gtest("parse: 'warning' in the level position maps to compile-warning [surface: 'parseCheckOutput' clause 1 'accept warning ... for robustness']", () => {
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ readFile });
  const [d] = oracle.parseCheckOutput(TSC_WARNING);
  assert.strictEqual(d.level, "warning");
  assert.strictEqual(d.kind, "compile-warning");
  assert.strictEqual(d.code, "TS2322");
});

gtest("parse: one readFile per distinct file per parse call - two diagnostics share the read [surface: 'parseCheckOutput' 'One file read per distinct file per parse call']", () => {
  const { readFile, calls } = readerFor({ "src/app.ts": TWO_ERRORS_SRC });
  const oracle = new TsOracle({ readFile });
  const diags = oracle.parseCheckOutput(TSC_TWO_ERRORS);
  assert.strictEqual(diags.length, 2);
  assert.strictEqual(calls.filter((p) => p === "src/app.ts").length, 1, "the second diagnostic reuses the cached content");
  assert.strictEqual(diags[0].spans[0].byteStart, 66, "line 1 (41+1) + 24 units of line 2");
  assert.strictEqual(diags[1].spans[0].byteStart, 127, "lines 1-2 (42+37 bytes incl newlines) + 48 units of line 3");
});

// ===========================================================================
// checkSuccess. [surface: 'checkSuccess(stdout, exitCode)']
// ===========================================================================

gtest("checkSuccess: exitCode === 0 is the whole verdict, stdout ignored [surface: 'checkSuccess']", () => {
  const oracle = new TsOracle();
  const cases = [
    { stdout: TSC_CLEAN, exitCode: 0, want: true, why: "clean run" },
    { stdout: TSC_TYPE_ERROR, exitCode: 2, want: false, why: "real error run exits 2" },
    { stdout: TSC_GLOBAL, exitCode: 2, want: false, why: "config failure exits non-zero" },
    { stdout: TSC_TYPE_ERROR, exitCode: 0, want: true, why: "stdout is ignored: exit 0 wins even with error-looking text" },
    { stdout: "", exitCode: 1, want: false, why: "stdout is ignored: non-zero fails even when silent" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.checkSuccess(c.stdout, c.exitCode), c.want, c.why);
  }
});

// ===========================================================================
// resolveDiagnosticPath. [surface: 'resolveDiagnosticPath(crateRoot, fileName, fileExists?)']
// ===========================================================================

gtest("resolveDiagnosticPath: absolute passthrough, relative joins crateRoot [surface: 'resolveDiagnosticPath']", () => {
  const oracle = new TsOracle();
  assert.strictEqual(oracle.resolveDiagnosticPath(PROJ, "/abs/elsewhere.ts"), "/abs/elsewhere.ts", "absolute passes through unchanged");
  assert.strictEqual(
    oracle.resolveDiagnosticPath(PROJ, "src/app.ts"),
    path.join(PROJ, "src", "app.ts"),
    "relative joins crateRoot via the platform join"
  );
});

gtest("resolveDiagnosticPath: NO workspace anchor walk - an existing anchor-side join never wins [surface: 'resolveDiagnosticPath' 'No workspace anchor walk - that is a cargo behavior']", () => {
  const oracle = new TsOracle();
  // A cargo-style resolver would prefer /mono/src/app.ts (it 'exists');
  // the TS resolver must still return the plain crateRoot join.
  const anchorish = existsIn(["/mono/tsconfig.json", "/mono/Cargo.toml", "/mono/src/app.ts"]);
  assert.strictEqual(
    oracle.resolveDiagnosticPath("/mono/packages/app", "src/app.ts", anchorish),
    path.join("/mono/packages/app", "src", "app.ts"),
    "tsc reports relative to the cwd buildCheckCommand pinned: crateRoot"
  );
});

// ===========================================================================
// isAssertionShaped. [surface: 'isAssertionShaped(diagnostic)']
// ===========================================================================

const tsDiag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  code: "TS2322",
  message: "Type 'string' is not assignable to type 'number'.",
  spans: [
    {
      fileName: "/proj/src/app.ts",
      byteStart: 36,
      byteEnd: 36,
      lineStart: 2,
      lineEnd: 2,
      columnStart: 7,
      columnEnd: 7,
      isPrimary: true,
    },
  ],
  suggestions: [],
  ...over,
});

gtest("isAssertionShaped: kind-only - 'assertion-failure' true, rustc-shaped TEXT stays false [surface: 'isAssertionShaped' 'There is NO text family for TS']", () => {
  const oracle = new TsOracle();
  const cases = [
    { d: tsDiag({ kind: "assertion-failure", message: "anything at all" }), want: true, why: "producer-assigned kind is the only signal" },
    { d: tsDiag({ message: "assertion `left == right` failed" }), want: false, why: "rustc-shaped text is NOT refused for TS (scraps finding-4 guarantee)" },
    { d: tsDiag({ message: "assertion failed: totals must match" }), want: false, why: "the other rustc text shape is not refused either" },
    { d: tsDiag(), want: false, why: "a plain TS2322 is not assertion-shaped" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.isAssertionShaped(c.d), c.want, c.why);
  }
});

// ===========================================================================
// Test rung: none. [surface: 'Test rung']
// ===========================================================================

gtest("no rung: runTestOracle resolves undefined, never runs, logs the skip [surface: 'Test rung' 'no test rung for typescript']", async () => {
  const oracle = new TsOracle({ fileExists: PROJ_FS });
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  const result = await runTestOracle(oracle, "/proj/src/app.ts", "some::filter", { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(result, undefined, "no rung -> undefined, not an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked");
  assert.ok(
    lines.some((l) => l.includes("no test rung for typescript")),
    `the skip line names the missing rung, got ${JSON.stringify(lines)}`
  );
});

// ===========================================================================
// oracleFor registration. [surface: 'oracleFor registration']
// ===========================================================================

gtest("oracleFor: the four TS/JS ids construct a TsOracle, rust keeps precedence [surface: 'oracleFor registration']", () => {
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const oracle = oracleFor(id);
    assert.ok(oracle, `oracleFor(${JSON.stringify(id)}) resolves an oracle`);
    assert.strictEqual(oracle.language, "typescript", `${id} -> language 'typescript'`);
    assert.ok(oracle instanceof TsOracle, `${id} -> a TsOracle instance`);
  }
  const rust = oracleFor("rust");
  assert.ok(rust, "rust still resolves");
  assert.strictEqual(rust.language, "rust", "rust keeps precedence, never a TsOracle");
});

gtest("oracleFor: unregistered ids stay undefined [surface: 'oracleFor registration']", () => {
  // python left this set at v11 supersession (PyOracle wired into oracleFor);
  // its registration is pinned in full by blind-v11-pyoracle.test.cjs.
  for (const id of ["plaintext", "vue", "svelte", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) must be undefined`);
  }
});

gtest("oracleFor deps: injected fileExists reaches the TsOracle - fake tsconfig + fake tsc resolve without disk [surface: 'oracleFor registration' 'deps pass through']", () => {
  const oracle = oracleFor("typescript", { fileExists: PROJ_FS });
  assert.strictEqual(oracle.detectCrateRoot("/proj/src/index.ts"), PROJ, "the fake project is honored, so fileExists was injected");
  assert.strictEqual(oracle.detectCrateRoot("/elsewhere/index.ts"), undefined);
});

gtest("oracleFor deps: log passes through, readFile takes its default (undefined on unreadable) [surface: 'Construction' 'readFile takes its default when constructed via the registry']", () => {
  const lines = [];
  const oracle = oracleFor("typescript", { fileExists: PROJ_FS, log: (l) => lines.push(l) });
  // The default readFile hits the real fs; /nope/... cannot exist, so the
  // span falls back to -1 and the injected log receives the skip.
  const [d] = oracle.parseCheckOutput(TSC_UNREADABLE);
  assert.strictEqual(d.spans[0].byteStart, -1, "default readFile returns undefined on error -> -1 sentinel");
  assert.strictEqual(d.spans[0].byteEnd, -1);
  assert.ok(lines.length > 0, "the injected log fn received the skip line");
});

// ===========================================================================
// Orchestrator glue: coverage probe + exit-code verdict + parse ride
// runOracleCheck. [surface: 'Coverage probe' + 'checkSuccess' + phase 1 §4]
// Positive coverage is remembered PROCESS-WIDE per (crateRoot, filePath), so
// every case below gets its own distinct fake root - a shared root would let
// an earlier case's cached positive skip a later case's probe.
// ===========================================================================

// A fake TS project rooted at `root`, with the file the check accepts.
const tsProj = (root) => ({
  root,
  fs: existsIn([path.join(root, "tsconfig.json"), path.join(root, "node_modules/typescript/bin/tsc")]),
  tsc: path.join(root, "node_modules/typescript/bin/tsc"),
  file: path.join(root, "src", "app.ts"),
});

const isProbe = (cmd) => cmd.args.includes("--listFilesOnly");

gtest("runOracleCheck with a TsOracle: probe spawns FIRST, a covering file list lets the check run, verdict from the exit code [surface: 'Coverage probe' + 'buildCheckCommand' + 'checkSuccess']", async () => {
  const P = tsProj("/probe-ok");
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ fileExists: P.fs, readFile });
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) {
      // --listFilesOnly answer: lib files plus the accepted file, absolute.
      return {
        stdout: path.join(P.root, "node_modules/typescript/lib/lib.es2020.d.ts") + "\n" + P.file + "\n",
        exitCode: 0,
      };
    }
    return { stdout: TSC_TYPE_ERROR, exitCode: 2 };
  };

  const failing = await runOracleCheck(oracle, P.file, { runCommand });
  assert.strictEqual(calls.length, 2, "two spawns: the probe, then the check");
  assert.ok(isProbe(calls[0]), "the FIRST spawn is the coverage probe (--listFilesOnly)");
  assert.ok(calls[0].args.includes("-p") && calls[0].args.includes(P.root), "the probe targets the crate root project");
  assert.deepStrictEqual(
    { command: calls[1].command, args: calls[1].args, cwd: calls[1].cwd, env: calls[1].env },
    {
      command: process.execPath,
      args: [P.tsc, "--noEmit", "--pretty", "false", "-p", P.root],
      cwd: P.root,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
    "the second spawn is the amended TS check command"
  );
  assert.ok(failing, "a completed run resolves a result");
  assert.strictEqual(failing.success, false, "exit 2 -> failure, the TS exit-code verdict");
  assert.strictEqual(failing.crateRoot, P.root);
  assert.strictEqual(failing.diagnostics.length, 1);
  assert.strictEqual(failing.diagnostics[0].code, "TS2322");
  assert.strictEqual(failing.diagnostics[0].spans[0].byteStart, 36, "byte conversion rode along");

  // The positive is cached process-wide: the second check of the SAME
  // (root, file) pair spawns no second probe.
  const clean = await runOracleCheck(oracle, P.file, {
    runCommand: async (cmd) => {
      calls.push(cmd);
      return { stdout: TSC_CLEAN, exitCode: 0 };
    },
  });
  assert.strictEqual(clean.success, true, "exit 0 -> success");
  assert.deepStrictEqual(clean.diagnostics, []);
  assert.strictEqual(calls.length, 3, "one more spawn only: the probe ran once per (root, file)");
  assert.ok(!isProbe(calls[2]), "the repeat run goes straight to the check");
});

// ---------------------------------------------------------------------------
// AMENDED not-covered clause (4B: phase4-surface.md 'Oracle honesty riders',
// '4B amendments' coverage-fallback rule, '4B amendments round 2'
// Supersession). Not-covered no longer goes straight dark: the fallback probes
// (a) projects in the nearest tsconfig's `references`, then (b) sibling
// tsconfig.*.json files in the same directory; the first project whose probe
// covers the file wins, the CHECK spawns for a real verdict, and the winner is
// cached per (root, file). Covered by NOTHING keeps the phase 2 pin: no check,
// the `is not an input of` evidence line.
//
// The fallback discovers siblings/references from the project directory and
// the surface pins no directory-listing dep, so these three arms scaffold REAL
// scratch dirs (placeholder tsc: every spawn still rides the fake runCommand
// transcript). The rest of this suite stays virtual-fs.
// ---------------------------------------------------------------------------

const fsReal = require("fs");
const os = require("os");

const coverageScratchRoots = [];
test.after(() => {
  for (const r of coverageScratchRoots) fsReal.rmSync(r, { recursive: true, force: true });
});

// A real project dir under tmp: the given tree plus a placeholder local tsc
// (detection needs the file to exist; nothing ever executes it).
const mkCoverageProj = (tag, tree) => {
  const root = fsReal.mkdtempSync(path.join(os.tmpdir(), `blind-v9-tsoracle-${tag}-`));
  coverageScratchRoots.push(root);
  for (const [rel, content] of Object.entries(tree)) {
    const p = path.join(root, rel);
    fsReal.mkdirSync(path.dirname(p), { recursive: true });
    fsReal.writeFileSync(p, content);
  }
  const tscStub = path.join(root, "node_modules", "typescript", "bin", "tsc");
  fsReal.mkdirSync(path.dirname(tscStub), { recursive: true });
  fsReal.writeFileSync(tscStub, "// placeholder: satisfies detection; spawns are faked\n");
  return root;
};

// The project a probe targets: the value after -p. Which exact path the
// fallback passes (dir vs tsconfig file) is implementation-chosen (round 2
// amendment 6), so tests match on substrings, never exact -p values.
const pTarget = (cmd) => {
  const i = cmd.args.indexOf("-p");
  return i === -1 ? "" : cmd.args[i + 1] || "";
};

// Fake transcript: probes answer --listFilesOnly per project - `coversWhen`
// decides from the -p target whether that project's list carries the file;
// non-covering projects answer a real-shaped lib-only list. The check answers
// clean (the verdict machinery is pinned by the probe-ok clause above).
const coverageRunCommand = (root, file, coversWhen, calls) => async (cmd) => {
  calls.push(cmd);
  if (isProbe(cmd)) {
    const lib = path.join(root, "node_modules/typescript/lib/lib.es2020.d.ts") + "\n";
    return { stdout: coversWhen(pTarget(cmd)) ? lib + file + "\n" : lib, exitCode: 0 };
  }
  return { stdout: TSC_CLEAN, exitCode: 0 };
};

gtest("coverage probe: a file covered by NOTHING resolves undefined - probes may fan out, the check is NEVER spawned [surface: 'Coverage probe' 'Not covered' + 4B 'nothing found = the existing honest-dark skip with its evidence line']", async () => {
  const root = mkCoverageProj("orphan", {
    "tsconfig.json": JSON.stringify({ include: ["src"] }, null, 2),
    "src/other.ts": "export const fine: number = 1;\n",
    "other/lone.ts": "export const lone: number = 1;\n",
  });
  const file = path.join(root, "other", "lone.ts");
  const oracle = new TsOracle();
  const calls = [];
  const lines = [];
  const result = await runOracleCheck(oracle, file, {
    runCommand: coverageRunCommand(root, file, () => false, calls),
    log: (l) => lines.push(l),
  });
  assert.strictEqual(result, undefined, "no project covers the file -> undefined, the unearned green is refused");
  assert.ok(calls.length >= 1, "at least the nearest-root probe ran");
  assert.ok(
    calls.every(isProbe),
    `every spawn is a --listFilesOnly probe - the check command is NEVER spawned; spawned ${JSON.stringify(calls.map((c) => c.args))}`
  );
  assert.ok(
    lines.some((l) => l.includes("is not an input of") && l.includes(file)),
    `the honest-dark skip line names the file, got ${JSON.stringify(lines)}`
  );
});

gtest("coverage fallback (references): a vite-style solution shell (files:[] + references) probes the referenced project, coverage found, the check SPAWNS; the winner is cached per (root, file) [surface: 4B 'check (a) projects listed in that tsconfig's references' + 'First project whose probe covers the file wins and is cached'; supersedes the phase 2 not-covered skip for this shape]", async () => {
  const root = mkCoverageProj("vshell", {
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }, null, 2),
    "tsconfig.app.json": JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }, null, 2),
    "src/App.tsx": "export const App = (): number => 1;\n",
  });
  const file = path.join(root, "src", "App.tsx");
  const covers = (target) => target.includes("tsconfig.app");
  const oracle = new TsOracle();
  const calls = [];
  const lines = [];
  const result = await runOracleCheck(oracle, file, {
    runCommand: coverageRunCommand(root, file, covers, calls),
    log: (l) => lines.push(l),
  });
  assert.ok(
    result,
    `the shell resolves through its reference - a real verdict, not the old skip; spawned ${JSON.stringify(calls.map((c) => c.args))}, logs ${JSON.stringify(lines)}`
  );
  assert.strictEqual(result.success, true, "the winning check's clean exit is the verdict");
  const probes = calls.filter(isProbe);
  const checks = calls.filter((c) => !isProbe(c));
  assert.strictEqual(checks.length, 1, `the check spawned exactly ONCE, on the winner; spawned ${JSON.stringify(calls.map((c) => c.args))}`);
  assert.ok(isProbe(calls[0]), "probing still comes first");
  assert.ok(!covers(pTarget(calls[0])), "the FIRST probe targets the nearest tsconfig - the fallback runs only on its not-covered answer");
  assert.ok(probes.length >= 2, "the not-covered path fanned out to at least one fallback probe");
  assert.ok(probes.some((c) => covers(pTarget(c))), "a fallback probe targeted the referenced tsconfig.app project");
  assert.ok(
    lines.every((l) => !(l.includes("is not an input of") && l.includes(file))),
    `covered via fallback: no honest-dark skip line for this file, got ${JSON.stringify(lines)}`
  );

  // Cached winner: the repeat run of the SAME (root, file) issues NO new
  // probes, only the check - the phase 2 positive-cache discipline.
  const calls2 = [];
  const again = await runOracleCheck(oracle, file, {
    runCommand: coverageRunCommand(root, file, covers, calls2),
    log: (l) => lines.push(l),
  });
  assert.ok(again && again.success === true, "the cached winner still delivers a verdict");
  assert.strictEqual(calls2.length, 1, `the repeat run spawns only the check; spawned ${JSON.stringify(calls2.map((c) => c.args))}`);
  assert.ok(!isProbe(calls2[0]), "no new probes: the winning answer is remembered per (root, file)");
});

gtest("coverage fallback (siblings): tsconfig.json not covering the file, sibling tsconfig.server.json covering it - the fallback probes the sibling and the check SPAWNS [surface: 4B '(b) sibling tsconfig.*.json files in the same directory (the tsconfig.server.json / tsconfig.node.json shape)']", async () => {
  const root = mkCoverageProj("sibling", {
    "tsconfig.json": JSON.stringify({ include: ["src"] }, null, 2),
    "tsconfig.server.json": JSON.stringify({ include: ["server"] }, null, 2),
    "src/index.ts": "export const fine: number = 1;\n",
    "server/main.ts": "export const boot = (): number => 1;\n",
  });
  const file = path.join(root, "server", "main.ts");
  const covers = (target) => target.includes("tsconfig.server");
  const oracle = new TsOracle();
  const calls = [];
  const lines = [];
  const result = await runOracleCheck(oracle, file, {
    runCommand: coverageRunCommand(root, file, covers, calls),
    log: (l) => lines.push(l),
  });
  assert.ok(
    result,
    `the sibling config covers this file - a real verdict, not the old skip; spawned ${JSON.stringify(calls.map((c) => c.args))}, logs ${JSON.stringify(lines)}`
  );
  assert.strictEqual(result.success, true, "the winning check's clean exit is the verdict");
  const probes = calls.filter(isProbe);
  const checks = calls.filter((c) => !isProbe(c));
  assert.strictEqual(checks.length, 1, `the check spawned exactly ONCE, on the winner; spawned ${JSON.stringify(calls.map((c) => c.args))}`);
  assert.ok(isProbe(calls[0]), "probing still comes first");
  assert.ok(!covers(pTarget(calls[0])), "the FIRST probe targets the nearest tsconfig - the sibling is probed only after not-covered");
  assert.ok(probes.length >= 2, "the not-covered path fanned out to at least one sibling probe");
  assert.ok(probes.some((c) => covers(pTarget(c))), "a fallback probe targeted the sibling tsconfig.server.json project");
  assert.ok(
    lines.every((l) => !(l.includes("is not an input of") && l.includes(file))),
    `covered via fallback: no honest-dark skip line for this file, got ${JSON.stringify(lines)}`
  );
});

gtest("coverage probe: a diagnostic answer (old tsc without --listFilesOnly) fails OPEN [surface: 'Coverage probe' 'Fail OPEN']", async () => {
  const P = tsProj("/probe-old");
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ fileExists: P.fs, readFile });
  const calls = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) {
      // DERIVED: the shape an old tsc answers with instead of a file list.
      return { stdout: "error TS5023: Unknown compiler option '--listFilesOnly'.\n", exitCode: 1 };
    }
    return { stdout: TSC_TYPE_ERROR, exitCode: 2 };
  };
  const result = await runOracleCheck(oracle, P.file, { runCommand });
  assert.strictEqual(calls.length, 2, "the check still ran: never worse than trusting the check alone");
  assert.ok(result, "fail-open resolves a result");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.diagnostics[0].code, "TS2322");
});

gtest("coverage probe: a REJECTING probe spawn fails open and logs it [surface: 'Coverage probe' 'A probe spawn REJECTION fails open']", async () => {
  const P = tsProj("/probe-boom");
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ fileExists: P.fs, readFile });
  const calls = [];
  const lines = [];
  const runCommand = async (cmd) => {
    calls.push(cmd);
    if (isProbe(cmd)) throw new Error("spawn ENOENT");
    return { stdout: TSC_TYPE_ERROR, exitCode: 2 };
  };
  const result = await runOracleCheck(oracle, P.file, { runCommand, log: (l) => lines.push(l) });
  assert.strictEqual(calls.length, 2, "probe attempted, check still ran");
  assert.ok(isProbe(calls[0]), "the rejection came from the probe, not the check");
  assert.ok(result, "the probe rejection never kills the check");
  assert.strictEqual(result.success, false, "the verdict is the check's own");
  assert.strictEqual(result.diagnostics[0].code, "TS2322");
  assert.ok(
    lines.some((l) => l.includes("coverage probe failed, assuming covered")),
    `the fail-open is logged, got ${JSON.stringify(lines)}`
  );
});

// ===========================================================================
// Repair integration guarantee. [surface: 'Repair integration guarantee']
// ===========================================================================

// A scope over the type-error file; bytes wide open unless a test narrows.
const TS_SCOPE = {
  filePath: path.join(PROJ, "src", "app.ts"),
  crateRoot: PROJ,
  byteStart: 0,
  byteEnd: 1000,
};

gtest("repair hook: classifyEligibility with the TsOracle classifier keeps rustc-assertion-SHAPED text eligible [surface: 'Repair integration guarantee' clause 1]", () => {
  const oracle = new TsOracle();
  const hooks = { assertionShaped: (x) => oracle.isAssertionShaped(x) };

  const shapedText = tsDiag({ message: "assertion `left == right` failed" });
  const kept = classifyEligibility(shapedText, TS_SCOPE, hooks);
  assert.strictEqual(kept.eligible, true, "TS has no text family: the rustc-shaped message is NOT refused");

  const producerKind = tsDiag({ kind: "assertion-failure" });
  const refused = classifyEligibility(producerKind, TS_SCOPE, hooks);
  assert.strictEqual(refused.eligible, false, "kind 'assertion-failure' stays refused always");
  assert.strictEqual(refused.reason, "assertion-failure");
});

gtest("repair hook: RepairScope.resolvePath with the TS resolver places a root-relative span inside the scope [surface: 'Repair integration guarantee' clause 2]", () => {
  const oracle = new TsOracle();
  // Discriminating layout: the cargo-shaped default would resolve the span
  // via the /mono workspace anchor (Cargo.toml + existing join) to
  // /mono/src/app.ts - NOT the scope's file. The TS resolver must land on
  // the crateRoot join instead.
  const scope = {
    filePath: path.join("/mono/packages/app", "src", "app.ts"),
    crateRoot: "/mono/packages/app",
    byteStart: 0,
    byteEnd: 1000,
    fileExists: existsIn(["/mono/Cargo.toml", "/mono/src/app.ts"]),
  };
  const d = tsDiag({
    spans: [{ ...tsDiag().spans[0], fileName: "src/app.ts" }],
  });

  const withoutHook = classifyEligibility(d, scope);
  assert.strictEqual(withoutHook.eligible, false, "the Rust-shaped default resolves the span into another file");
  assert.strictEqual(withoutHook.reason, "out-of-span");

  const withHook = classifyEligibility(d, {
    ...scope,
    resolvePath: (root, name) => oracle.resolveDiagnosticPath(root, name),
  });
  assert.strictEqual(withHook.eligible, true, "the TS resolver joins crateRoot and lands on scope.filePath");
});

gtest("repair hook: a zero-width TS span on the scope boundary counts inside [surface: 'parseCheckOutput' 'zero-width spans are already first-class in eligibility']", () => {
  const oracle = new TsOracle();
  const d = tsDiag(); // span at byte 36..36
  const boundary = { ...TS_SCOPE, byteStart: 0, byteEnd: 36 };
  const r = classifyEligibility(d, boundary, { assertionShaped: (x) => oracle.isAssertionShaped(x) });
  assert.strictEqual(r.eligible, true, "a point on the scope boundary is inside");
});

gtest("repair session: an eligible TS compile error reaches kind 'repair' through the neutral machinery [surface: 'Repair integration guarantee' clause 3]", () => {
  const { readFile } = readerFor({ "src/app.ts": TYPE_ERROR_SRC });
  const oracle = new TsOracle({ fileExists: PROJ_FS, readFile });
  // The diagnostic is the REAL parsed one, not hand-built: parse -> classify
  // -> session, the same path a live check walks.
  const diags = oracle.parseCheckOutput(TSC_TYPE_ERROR);
  const check = { success: false, diagnostics: diags, durationMs: 5, crateRoot: PROJ };
  const scope = {
    ...TS_SCOPE,
    resolvePath: (root, name) => oracle.resolveDiagnosticPath(root, name),
  };
  const session = new RepairSession("fim", true, () => {}, {
    assertionShaped: (x) => oracle.isAssertionShaped(x),
  });
  const action = session.next(check, scope);
  assert.strictEqual(action.kind, "repair", `an eligible TS compile error repairs, got ${JSON.stringify(action && { kind: action.kind, why: action.why })}`);
});
