// Blind oracle: the Go compiler oracle (session-v23/goal.md, GoOracle).
// Black-box contract tests written from the CompilerOracle surface alone,
// before src/core/goOracle.ts exists. Headless: every spawn is a fake
// runCommand; the real toolchain lives in blind-v23-gooracle-live.test.cjs.
// Contract points covered:
//   Construction    GoOracle(deps), language === "go", checkLabel "go build",
//                   coverage pair present, NO test rung
//   appliesTo       "go" true; every other id false
//   oracleFor       "go" registers; rust/ts/csharp/python keep precedence
//   detectCrateRoot nearest go.mod parent-ward (injected fileExists); the
//                   workspace refusal: go.work at/above the go.mod dir, or a
//                   process-visible GOWORK path, -> undefined + the
//                   "workspace mode, not supported yet" reason; GOWORK=off
//                   disables the refusal; plain no-go.mod names go.mod
//   buildCheckCommand  go build -o /dev/null ./... at crateRoot, env pins
//                   GOPROXY=off + GOWORK=off, GOFLAGS never names
//                   -mod=vendor/-mod=mod, and a diagnostics-on-stderr flag
//   parseCheckOutput   `relpath/file.go:LINE:COL: message` lines ->
//                   Diagnostics; `# pkg` headers dropped; garbage never
//                   throws; module-level `go:` lines surface through
//                   diagnostics OR describeCheckFailure, never dropped
//   checkSuccess    exit-code governed: 0 true, non-zero false, regardless
//                   of parseable lines
//   describeCheckFailure  zero-diagnostic non-zero exits get honest text
//   resolveDiagnosticPath crateRoot-joined relative; absolute passthrough
//   isAssertionShaped  false for the four ordinary hallucination classes
//   coverage        go list -json probe; fileCovered over the concatenated
//                   JSON stream: GoFiles covered, IgnoredGoFiles /
//                   TestGoFiles / XTestGoFiles / no-package not covered
//   orchestration   runOracleCheck probe-first, stderr-carried diagnostics
//                   ride out; a not-covered file keeps the check dark
//
// Never read src/**. Expected RED: src/core/goOracle.ts does not exist yet,
// so the bundle fails; the guard keeps one loud surface failure and skips
// the rest until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v23-gooracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v23-gooracle",
    `export { GoOracle } from "../src/core/goOracle";\n` +
      `export { oracleFor, runOracleCheck, runTestOracle } from "../src/core/compilerOracle";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.GoOracle !== "function") {
  bundleError = new Error("the bundle built but exports no GoOracle class from src/core/goOracle.ts");
}
test.after(() => cleanup());

const { GoOracle, oracleFor, runOracleCheck, runTestOracle } = mod;

test("bundle: the v23 gooracle surface builds (GoOracle in src/core/goOracle.ts) [surface: goal 'GoOracle' ships]", () => {
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
// Shared plumbing. detectCrateRoot rides an injected fileExists, so the trees
// below are virtual: `present` is the exhaustive set of paths that exist.
// GOWORK is process-visible env; tests that touch it save and restore.
// ---------------------------------------------------------------------------

const existsOnly = (present) => (p) => present.includes(p);

const withGowork = (value, fn) => {
  const saved = process.env.GOWORK;
  if (value === undefined) delete process.env.GOWORK;
  else process.env.GOWORK = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.GOWORK;
    else process.env.GOWORK = saved;
  }
};

const scratch = [];
test.after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `blind-v23-${tag}-`));
  scratch.push(d);
  return d;
};

const FUTURE = () => Date.now() + 3_600_000;

// Realistic `go build -o /dev/null ./...` stderr: one package header, two
// diagnostic lines (missing method + undefined name), receiver-type-named.
const BUILD_TEXT =
  "# x/lib\n" +
  "lib/widget.go:12:7: w.Resizee undefined (type Widget has no field or method Resizee, but does have method Resize)\n" +
  "lib/widget.go:15:9: undefined: conjureWidget\n";

// A module-level failure: no file:line:col anywhere, `go:`-prefixed.
const VENDOR_TEXT =
  "go: inconsistent vendoring in /w/proj:\n" +
  "\texample.com/dep@v1.0.0: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt\n" +
  "\n" +
  "\tTo ignore the vendor directory, use -mod=mod.\n" +
  "\tTo sync the vendor directory, run:\n" +
  "\t\tgo mod vendor\n";

// ===========================================================================
// Construction + registration. [surface: 'new GoOracle(deps?)' + oracleFor]
// ===========================================================================

gtest("construction: GoOracle takes optional deps, pins language 'go' and checkLabel 'go build' [surface: language === 'go', checkLabel === 'go build']", () => {
  assert.strictEqual(new GoOracle().language, "go", "language is the readonly literal 'go'");
  assert.strictEqual(new GoOracle({ log: () => {} }).language, "go", "deps object accepted, language holds");
  assert.strictEqual(new GoOracle({ fileExists: () => false }).language, "go", "fileExists dep accepted");
  assert.strictEqual(new GoOracle().checkLabel, "go build", "the verdict-line label is exactly 'go build'");
});

gtest("construction: required strategy methods present, the coverage pair present, NO test rung [surface: CompilerOracle interface + goal 'coverage probe is go list -json' + goal 'TDD gesture ... not this slice']", () => {
  const oracle = new GoOracle();
  for (const m of ["appliesTo", "detectCrateRoot", "buildCheckCommand", "parseCheckOutput", "checkSuccess", "resolveDiagnosticPath", "isAssertionShaped"]) {
    assert.strictEqual(typeof oracle[m], "function", `required strategy method: ${m}`);
  }
  assert.strictEqual(typeof oracle.buildCoverageCommand, "function", "the Go coverage probe pair is present (build-tag/_test.go unearned greens need it)");
  assert.strictEqual(typeof oracle.fileCovered, "function", "fileCovered is present");
  assert.strictEqual(typeof oracle.describeCheckFailure, "function", "describeCheckFailure exists (zero-diagnostic crash honesty needs a text channel)");
  assert.strictEqual(oracle.buildTestCommand, undefined, "no Go test rung in v23: buildTestCommand absent");
  assert.strictEqual(oracle.parseTestOutput, undefined, "no Go test rung in v23: parseTestOutput absent");
});

gtest("appliesTo: true for 'go' only, false for every other id [surface: appliesTo('go') true and false for other ids]", () => {
  const oracle = new GoOracle();
  assert.strictEqual(oracle.appliesTo("go"), true);
  for (const id of ["rust", "typescript", "javascript", "csharp", "python", "golang", "Go", "GO", "", "plaintext"]) {
    assert.strictEqual(oracle.appliesTo(id), false, `appliesTo(${JSON.stringify(id)}) is false`);
  }
});

gtest("oracleFor: 'go' constructs a GoOracle; rust/typescript/csharp/python keep precedence [surface: oracleFor('go') returns an oracle with language 'go']", () => {
  const go = oracleFor("go");
  assert.ok(go, "oracleFor('go') resolves an oracle");
  assert.strictEqual(go.language, "go");
  assert.ok(go instanceof GoOracle, "it is a GoOracle instance");
  for (const id of ["rust", "typescript", "csharp", "python"]) {
    const o = oracleFor(id);
    assert.ok(o && o.language === id, `${id} still resolves to its own strategy`);
    assert.ok(!(o instanceof GoOracle), `the Go oracle did not swallow ${id}`);
  }
});

gtest("oracleFor: unregistered ids stay undefined [surface: 'no registered oracle applies -> undefined']", () => {
  for (const id of ["java", "zig", "vue", ""]) {
    assert.strictEqual(oracleFor(id), undefined, `oracleFor(${JSON.stringify(id)}) is undefined`);
  }
});

// ===========================================================================
// detectCrateRoot: nearest go.mod parent-ward, via injected fileExists.
// [surface: detectCrateRoot + the workspace refusal]
// ===========================================================================

gtest("detectCrateRoot: nearest enclosing go.mod dir wins, walking parent-ward [surface: 'nearest enclosing dir containing go.mod']", () => {
  const root = path.join(path.sep, "w", "proj");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(root, "go.mod")]) });
  withGowork(undefined, () => {
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "pkg", "sub", "f.go")), root, "an ancestor go.mod places the file");
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "main.go")), root, "a file directly in the module dir resolves too");
  });
});

gtest("detectCrateRoot: a nested go.mod is nearer than the outer one [surface: 'nearest enclosing']", () => {
  const outer = path.join(path.sep, "w", "proj");
  const inner = path.join(outer, "tool");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(outer, "go.mod"), path.join(inner, "go.mod")]) });
  withGowork(undefined, () => {
    assert.strictEqual(oracle.detectCrateRoot(path.join(inner, "cmd", "f.go")), inner, "the nested module wins under tool/");
    assert.strictEqual(oracle.detectCrateRoot(path.join(outer, "lib", "g.go")), outer, "outside tool/, the outer module is nearest");
  });
});

gtest("detectCrateRoot: no go.mod anywhere up -> undefined; describeMissingRoot names go.mod [surface: 'undefined outside any module' + 'a plain missing-go.mod describeMissingRoot mentions go.mod']", () => {
  const oracle = new GoOracle({ fileExists: () => false });
  withGowork(undefined, () => {
    const file = path.join(path.sep, "w", "loose", "f.go");
    assert.strictEqual(oracle.detectCrateRoot(file), undefined, "outside any module: silently inapplicable, never an error");
    const reason = oracle.describeMissingRoot && oracle.describeMissingRoot(file);
    assert.strictEqual(typeof reason, "string", "describeMissingRoot produces a reason string");
    assert.ok(/go\.mod/.test(reason), `the plain missing-root reason names go.mod, got ${JSON.stringify(reason)}`);
  });
});

gtest("workspace refusal: go.work in the SAME dir as the nearest go.mod -> undefined + 'workspace mode, not supported yet' [surface: 'go.work file exists at ... the nearest go.mod dir']", () => {
  const root = path.join(path.sep, "w", "proj");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(root, "go.mod"), path.join(root, "go.work")]) });
  withGowork(undefined, () => {
    const file = path.join(root, "pkg", "f.go");
    assert.strictEqual(oracle.detectCrateRoot(file), undefined, "workspace mode is refused, not silently resolved");
    const reason = oracle.describeMissingRoot && oracle.describeMissingRoot(file);
    assert.strictEqual(typeof reason, "string", "the refusal is a plain reason, not a dark skip");
    assert.ok(reason.includes("workspace mode, not supported yet"), `the refusal text is pinned, got ${JSON.stringify(reason)}`);
  });
});

gtest("workspace refusal: go.work ABOVE the nearest go.mod dir also refuses [surface: 'or above the nearest go.mod dir']", () => {
  const ws = path.join(path.sep, "w");
  const root = path.join(ws, "proj");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(root, "go.mod"), path.join(ws, "go.work")]) });
  withGowork(undefined, () => {
    const file = path.join(root, "f.go");
    assert.strictEqual(oracle.detectCrateRoot(file), undefined, "a go.work parent auto-applies under go; the oracle refuses instead of resolving wrong");
    const reason = oracle.describeMissingRoot && oracle.describeMissingRoot(file);
    assert.ok(typeof reason === "string" && reason.includes("workspace mode, not supported yet"), `refusal text, got ${JSON.stringify(reason)}`);
  });
});

gtest("workspace refusal: GOWORK env set to a workspace file path refuses even with no go.work on the walk [surface: 'process-visible GOWORK env resolves to a workspace file']", () => {
  const root = path.join(path.sep, "w", "proj");
  const goworkFile = path.join(path.sep, "elsewhere", "go.work");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(root, "go.mod"), goworkFile]) });
  withGowork(goworkFile, () => {
    const file = path.join(root, "f.go");
    assert.strictEqual(oracle.detectCrateRoot(file), undefined, "GOWORK=<path> puts every go command in workspace mode: refuse");
    const reason = oracle.describeMissingRoot && oracle.describeMissingRoot(file);
    assert.ok(typeof reason === "string" && reason.includes("workspace mode, not supported yet"), `refusal text, got ${JSON.stringify(reason)}`);
  });
});

gtest("workspace refusal: GOWORK=off DISABLES the refusal - a go.work parent no longer blocks the module [surface: \"'off' disables; unset means walk\"]", () => {
  const ws = path.join(path.sep, "w");
  const root = path.join(ws, "proj");
  const oracle = new GoOracle({ fileExists: existsOnly([path.join(root, "go.mod"), path.join(ws, "go.work")]) });
  withGowork("off", () => {
    assert.strictEqual(oracle.detectCrateRoot(path.join(root, "f.go")), root, "GOWORK=off means go itself ignores go.work, so the module root is honest");
  });
});

// ===========================================================================
// buildCheckCommand. [surface: the exact spelling is load-bearing]
// ===========================================================================

gtest("buildCheckCommand: exactly `go build -o /dev/null ./...` at crateRoot, GOPROXY=off + GOWORK=off pinned, GOFLAGS never -mod=vendor/-mod=mod [surface: goal 'checker is go build -o /dev/null ./...' + the spawn-env pins]", () => {
  const root = path.join(path.sep, "w", "proj");
  const cmd = new GoOracle({ fileExists: () => true }).buildCheckCommand(root);
  assert.strictEqual(cmd.command, "go", "the command is the go binary");
  assert.deepStrictEqual(cmd.args, ["build", "-o", "/dev/null", "./..."], "the exact spelling: bare build drops a binary, -o <dir> skips non-main packages (golang/go#37378), -o /dev/null compiles everything and writes nothing");
  assert.strictEqual(cmd.cwd, root, "cwd is the module root");
  assert.ok(cmd.env, "a child env is set (go env -w user config leaks into every spawned go command)");
  assert.strictEqual(cmd.env.GOPROXY, "off", "GOPROXY=off: the offline invariant holds only for what the spawn pins");
  assert.strictEqual(cmd.env.GOWORK, "off", "GOWORK=off on the CHECK: detectCrateRoot already refused real workspaces, so the check never lets a go.work reshape resolution");
  if (cmd.env.GOFLAGS !== undefined) {
    assert.ok(!/-mod=(vendor|mod)\b/.test(cmd.env.GOFLAGS), `GOFLAGS must not force -mod=vendor or -mod=mod (vendor detection stays go's own), got ${JSON.stringify(cmd.env.GOFLAGS)}`);
  }
});

gtest("buildCheckCommand: the command carries a diagnostics-arrive-on-stderr flag (own property matching /stderr/i, truthy) [surface: 'this toolchain's diagnostics arrive on stderr']", () => {
  const cmd = new GoOracle({ fileExists: () => true }).buildCheckCommand(path.join(path.sep, "w", "proj"));
  const key = Object.getOwnPropertyNames(cmd).find((k) => /stderr/i.test(k));
  assert.ok(key, `some own property names stderr (go build writes diagnostics there, stdout stays empty), got keys ${JSON.stringify(Object.getOwnPropertyNames(cmd))}`);
  assert.ok(cmd[key], `the stderr flag ${JSON.stringify(key)} is truthy`);
});

// ===========================================================================
// parseCheckOutput. [surface: `relpath/file.go:LINE:COL: message` lines]
// ===========================================================================

gtest("parse: diagnostic lines map file/line/col/message; the `# pkg` header line produces no diagnostic [surface: 'package-header lines ... produce no diagnostic']", () => {
  const oracle = new GoOracle();
  const diags = oracle.parseCheckOutput(BUILD_TEXT, path.join(path.sep, "w", "proj"), FUTURE());
  assert.strictEqual(diags.length, 2, `two diagnostic lines, the # x/lib header dropped; got ${JSON.stringify(diags.map((d) => d.message))}`);

  const member = diags.find((d) => d.message.includes("Resizee"));
  assert.ok(member, "the missing-method diagnostic surfaced");
  assert.strictEqual(member.kind, "compile-error");
  assert.strictEqual(member.level, "error");
  assert.ok(member.message.includes("has no field or method Resizee"), `the receiver-named message rides through, got ${JSON.stringify(member.message)}`);
  assert.ok(member.message.includes("Widget"), "the message names the receiver type (repair prompts want it)");
  assert.ok(member.spans.length >= 1, "the diagnostic carries a span");
  const s = member.spans[0];
  assert.strictEqual(s.fileName, "lib/widget.go", "the span fileName is the path as go build reported it (relative to the check cwd)");
  assert.strictEqual(s.lineStart, 12, "LINE maps to 1-based lineStart");
  assert.strictEqual(s.columnStart, 7, "COL maps to columnStart");
  assert.strictEqual(s.isPrimary, true, "the one location per line is primary");

  const undef = diags.find((d) => d.message.includes("conjureWidget"));
  assert.ok(undef, "the undefined-name diagnostic surfaced");
  assert.strictEqual(undef.level, "error");
  assert.strictEqual(undef.spans[0].lineStart, 15);
  assert.strictEqual(undef.spans[0].columnStart, 9);
});

gtest("parse: a header-only or empty text yields [] [surface: parseCheckOutput on a clean check]", () => {
  const oracle = new GoOracle();
  assert.deepStrictEqual(oracle.parseCheckOutput("", "/w/proj", FUTURE()), []);
  assert.deepStrictEqual(oracle.parseCheckOutput("# x/lib\n", "/w/proj", FUTURE()), [], "a bare package header is not a diagnostic");
});

gtest("parse: garbage lines never throw [surface: 'must never throw on garbage lines']", () => {
  const oracle = new GoOracle();
  for (const junk of ["not a diagnostic", "}{ %%   binary-ish", "widget.go without any colon structure", "a:b:c:d:e:f", "::::", "# ", "\t\tindented continuation without a parent\n"]) {
    let diags;
    assert.doesNotThrow(() => { diags = oracle.parseCheckOutput(junk, "/w/proj", FUTURE()); }, `garbage ${JSON.stringify(junk).slice(0, 30)} must not throw`);
    assert.ok(Array.isArray(diags), "unparseable text yields an array, not a crashed oracle");
  }
});

gtest("parse/describe: a module-level `go:` line (inconsistent vendoring) surfaces through diagnostics OR describeCheckFailure - never silently dropped on a failed check [surface: \"module-level `go:`-prefixed lines must ALSO surface ... either channel\"]", () => {
  const oracle = new GoOracle();
  assert.strictEqual(oracle.checkSuccess("", 1), false, "the vendoring failure exits non-zero: no green");
  let diags = [];
  assert.doesNotThrow(() => { diags = oracle.parseCheckOutput(VENDOR_TEXT, "/w/proj", FUTURE()); }, "the go:-prefixed text never crashes the parse");
  const firstLine = VENDOR_TEXT.split("\n")[0];
  const described = typeof oracle.describeCheckFailure === "function" ? oracle.describeCheckFailure(1, firstLine) || "" : "";
  const combined = diags.map((d) => d.message).join("\n") + "\n" + described;
  assert.ok(
    /inconsistent vendoring/.test(combined),
    `the module-level failure text is findable in diagnostics[].message joined + describeCheckFailure output; got diagnostics ${JSON.stringify(diags.map((d) => d.message))} and describeCheckFailure ${JSON.stringify(described)}`
  );
});

// ===========================================================================
// checkSuccess + crash honesty. [surface: 'exit 0 true, exit 1 false']
// ===========================================================================

gtest("checkSuccess: exit-code governed - 0 true even with diagnostic-looking text, non-zero false even with none [surface: 'exit 0 true, exit 1 false regardless of parseable lines']", () => {
  const oracle = new GoOracle();
  const cases = [
    { stdout: "", exitCode: 0, want: true, why: "clean build, empty output" },
    { stdout: BUILD_TEXT, exitCode: 0, want: true, why: "exit 0 wins regardless of parseable lines (stray text never fails a green build)" },
    { stdout: "", exitCode: 1, want: false, why: "exit 1 fails even with zero parseable lines" },
    { stdout: BUILD_TEXT, exitCode: 1, want: false, why: "the ordinary failing build" },
    { stdout: "", exitCode: 2, want: false, why: "any non-zero exit is a failed check" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.checkSuccess(c.stdout, c.exitCode), c.want, c.why);
  }
});

gtest("crash honesty: non-zero exit with unparseable output -> checkSuccess false AND describeCheckFailure text [surface: 'zero-diagnostic crash honesty']", () => {
  const oracle = new GoOracle();
  const crashText = "go: cannot find GOROOT directory: /nonexistent";
  assert.strictEqual(oracle.checkSuccess("", 2), false, "the crash is never a green");
  assert.deepStrictEqual(
    oracle.parseCheckOutput("flag provided but not defined: -bogus\nusage: go build ...\n", "/w/proj", FUTURE()).filter((d) => d.spans && d.spans.some((s) => /\.go$/.test(s.fileName))),
    [],
    "no file-positioned diagnostics come out of usage text"
  );
  const reason = oracle.describeCheckFailure(2, crashText);
  assert.strictEqual(typeof reason, "string", "describeCheckFailure produces text for the zero-diagnostic crash");
  assert.ok(reason.length > 0, "the crash reason is non-empty (the verdict surface has something honest to show)");
});

// ===========================================================================
// resolveDiagnosticPath + isAssertionShaped.
// ===========================================================================

gtest("resolveDiagnosticPath: relative joins onto crateRoot; absolute passes through [surface: 'crateRoot-joined for relative paths; absolute stays absolute']", () => {
  const oracle = new GoOracle();
  const root = path.join(path.sep, "w", "proj");
  assert.strictEqual(oracle.resolveDiagnosticPath(root, path.join("lib", "widget.go")), path.join(root, "lib", "widget.go"), "go build reports paths relative to the check cwd");
  assert.strictEqual(path.resolve(oracle.resolveDiagnosticPath(root, "./main.go")), path.join(root, "main.go"), "the ./ prefix go build sometimes emits resolves clean");
  const abs = path.join(path.sep, "abs", "elsewhere", "thing.go");
  assert.strictEqual(oracle.resolveDiagnosticPath(root, abs), abs, "an absolute path is not re-anchored");
});

const goDiag = (over = {}) => ({
  kind: "compile-error",
  level: "error",
  message: "w.Resizee undefined (type Widget has no field or method Resizee)",
  spans: [{ fileName: "lib/widget.go", byteStart: -1, byteEnd: -1, lineStart: 12, lineEnd: 12, columnStart: 7, columnEnd: 7, isPrimary: true }],
  suggestions: [],
  ...over,
});

gtest("isAssertionShaped: false for all four ordinary hallucination-class diagnostics; the producer 'assertion-failure' kind is refused [surface: 'false for ordinary compile-error diagnostics (e.g. the four hallucination classes)']", () => {
  const oracle = new GoOracle();
  const ordinary = [
    goDiag(),
    goDiag({ message: "undefined: conjureWidget" }),
    goDiag({ message: "no required module provides package example.com/absent/pkg; to add it:\n\tgo get example.com/absent/pkg" }),
    goDiag({ message: "b.Finalise undefined (type strings.Builder has no field or method Finalise)" }),
  ];
  for (const d of ordinary) {
    assert.strictEqual(oracle.isAssertionShaped(d), false, `an ordinary compile error stays repair-eligible: ${JSON.stringify(d.message.slice(0, 50))}`);
  }
  assert.strictEqual(oracle.isAssertionShaped(goDiag({ kind: "assertion-failure" })), true, "the producer-assigned assertion kind is refused (bar 4, the cs/py kind-only shape)");
});

// ===========================================================================
// Coverage probe pair. [surface: 'go list -json' + the GoFiles taxonomy]
// ===========================================================================

gtest("buildCoverageCommand: go list -json over ./... in crateRoot [surface: 'buildCoverageCommand(crateRoot) spawns go list -json over ./...']", () => {
  const root = path.join(path.sep, "w", "proj");
  const cmd = new GoOracle().buildCoverageCommand(root);
  assert.strictEqual(cmd.command, "go", "the probe is the go binary");
  assert.ok(cmd.args.includes("list"), `the probe verb is list, got ${JSON.stringify(cmd.args)}`);
  assert.ok(cmd.args.includes("-json"), `the probe asks for JSON, got ${JSON.stringify(cmd.args)}`);
  assert.ok(cmd.args.includes("./..."), `the probe walks the whole module (the check's own scope), got ${JSON.stringify(cmd.args)}`);
  assert.strictEqual(cmd.cwd, root, "cwd is the module root");
});

gtest("fileCovered: GoFiles covered; IgnoredGoFiles/TestGoFiles/XTestGoFiles and no-package files NOT covered, over a concatenated go list -json stream [surface: the coverage taxonomy]", () => {
  const root = path.join(path.sep, "w", "proj");
  const libDir = path.join(root, "lib");
  // go list -json emits back-to-back pretty-printed objects, not a JSON array.
  const stream =
    JSON.stringify({ Dir: root, ImportPath: "x", Name: "main", GoFiles: ["main.go"], IgnoredGoFiles: ["ignored.go"] }, null, "\t") +
    "\n" +
    JSON.stringify({ Dir: libDir, ImportPath: "x/lib", Name: "lib", GoFiles: ["lib.go", "util.go"], TestGoFiles: ["lib_test.go"], XTestGoFiles: ["lib_x_test.go"] }, null, "\t") +
    "\n";
  const oracle = new GoOracle();
  const cases = [
    { file: path.join(root, "main.go"), want: true, why: "a GoFiles member is a compiled input -> covered" },
    { file: path.join(libDir, "lib.go"), want: true, why: "GoFiles in the second package of the stream -> covered" },
    { file: path.join(libDir, "util.go"), want: true, why: "every GoFiles entry counts, not just the first" },
    { file: path.join(root, "ignored.go"), want: false, why: "IgnoredGoFiles (//go:build ignore et al) never reach go build: the unearned green is refused" },
    { file: path.join(libDir, "lib_test.go"), want: false, why: "TestGoFiles: go build ignores _test.go entirely, a broken test file builds green" },
    { file: path.join(libDir, "lib_x_test.go"), want: false, why: "XTestGoFiles are outside go build's sight too" },
    { file: path.join(root, "orphan", "nowhere.go"), want: false, why: "a file in no listed package is not covered" },
  ];
  for (const c of cases) {
    assert.strictEqual(oracle.fileCovered(stream, root, c.file), c.want, c.why);
  }
});

// ===========================================================================
// No test rung + orchestrator glue, fully injected runCommand.
// [surface: runOracleCheck + the stderr flag + the coverage probe]
// ===========================================================================

gtest("no rung: runTestOracle resolves undefined and never spawns [surface: 'buildTestCommand absent -> runTestOracle skips honestly']", async () => {
  const oracle = new GoOracle();
  const calls = [];
  const runCommand = async (cmd) => { calls.push(cmd); return { stdout: "", stderr: "", exitCode: 0 }; };
  const result = await runTestOracle(oracle, "/w/proj/main.go", "TestSomething", { runCommand, log: () => {} });
  assert.strictEqual(result, undefined, "no rung -> undefined, not an error");
  assert.strictEqual(calls.length, 0, "runCommand is never invoked");
});

gtest("runOracleCheck with a GoOracle: probe first, then the pinned build command; stderr-carried diagnostics and the failing verdict ride out [surface: runOracleCheck + 'diagnostics arrive on stderr']", async () => {
  await withGowork(undefined, async () => {
    const dir = mkTmp("orch");
    fs.writeFileSync(path.join(dir, "go.mod"), "module x\n\ngo 1.26\n");
    const src = path.join(dir, "main.go");
    fs.writeFileSync(src, "package main\n\nfunc main() {}\n");
    const oracle = new GoOracle();
    assert.strictEqual(oracle.detectCrateRoot(src), dir, "the real temp go.mod places the file");

    const isProbe = (cmd) => cmd.args.includes("list");
    const probeJson = JSON.stringify({ Dir: dir, ImportPath: "x", Name: "main", GoFiles: ["main.go"] }, null, "\t") + "\n";
    const STDERR_DIAGS =
      "# x\n" +
      "main.go:5:10: w.Nope undefined (type Widget has no field or method Nope)\n";
    const calls = [];
    const runCommand = async (cmd) => {
      calls.push(cmd);
      if (isProbe(cmd)) return { stdout: probeJson, stderr: "", exitCode: 0 };
      // go build: stdout EMPTY, diagnostics on stderr - the flag's whole point.
      return { stdout: "", stderr: STDERR_DIAGS, exitCode: 1 };
    };

    const result = await runOracleCheck(oracle, src, { runCommand });
    assert.ok(result, "a completed run resolves a result");
    assert.ok(calls.length >= 2, `probe then check, got ${calls.length} spawn(s)`);
    assert.ok(isProbe(calls[0]), "the FIRST spawn is the coverage probe (go list -json)");
    const check = calls[calls.length - 1];
    assert.deepStrictEqual(check.args, ["build", "-o", "/dev/null", "./..."], "the last spawn is the pinned check command");
    assert.strictEqual(result.success, false, "exit 1 -> failure verdict");
    assert.strictEqual(result.crateRoot, dir);
    assert.strictEqual(result.diagnostics.length, 1, `the stderr diagnostic rode out (the runner honored the stderr flag); got ${JSON.stringify(result.diagnostics.map((d) => d.message))}`);
    assert.ok(result.diagnostics[0].message.includes("has no field or method Nope"), "the receiver-named message survived the trip");
  });
});

gtest("runOracleCheck with a GoOracle: an IgnoredGoFiles file is not covered - the check never spawns, no unearned green [surface: 'a file excluded by //go:build ignore ... the coverage probe reports it not covered']", async () => {
  await withGowork(undefined, async () => {
    const dir = mkTmp("dark");
    fs.writeFileSync(path.join(dir, "go.mod"), "module x\n\ngo 1.26\n");
    const excluded = path.join(dir, "ignored.go");
    fs.writeFileSync(excluded, "//go:build ignore\n\npackage main\n");
    const oracle = new GoOracle();

    const isProbe = (cmd) => cmd.args.includes("list");
    const probeJson = JSON.stringify({ Dir: dir, ImportPath: "x", Name: "main", GoFiles: ["main.go"], IgnoredGoFiles: ["ignored.go"] }, null, "\t") + "\n";
    const calls = [];
    const result = await runOracleCheck(oracle, excluded, {
      runCommand: async (cmd) => { calls.push(cmd); return isProbe(cmd) ? { stdout: probeJson, stderr: "", exitCode: 0 } : { stdout: "", stderr: "", exitCode: 0 }; },
      log: () => {},
    });
    assert.strictEqual(result, undefined, "not a compiled input -> undefined, the gesture stays dark");
    assert.ok(calls.every(isProbe), `only probe(s) spawned, the check never ran; spawned ${JSON.stringify(calls.map((c) => c.args))}`);
  });
});
