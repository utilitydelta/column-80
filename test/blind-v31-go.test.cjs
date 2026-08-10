// Blind oracle: the Go TDD leg (session-v31/contract-go.md, goal.md item 2 and
// item 6). Black-box contract tests written from the CONTRACT ALONE, before
// `src/core/tddGo.ts` exists. Covers:
//   §Placement      sibling foo_test.go, module root, packageArg, the go.work refusal
//   §The command    -v, the anchored -run filter, and the anchoring as a REGEX PROPERTY
//   §The parse      the measured failing run, and the detail-before-verdict ordering
//   §The false green  `PASS` on a run that executed nothing. The most dangerous
//                   line in the Go parser and the one this file exists for.
//   §returnTypeOf   the pointer receiver and the function-typed parameter
//   §Testability    async/io/needs-fixture/underspecified, and never not-exported
//   §Blank values   scalars, slices, maps, and `error` as one hole
//   §expectedValueSpans  the `want :=` right-hand side, and Go's raw-string wrinkle
//   §Scaffold       package from the SOURCE file, one `testing` import, fenced markers
//
// Never read src/**. The whole point of this file is independence from the
// implementation. Expected RED until phase 2 lands.
//
// Two guards, both collapsing a whole class of red into ONE loud failure:
//   1. a failed bundle (the module is missing) fails the bundle test and SKIPS
//      everything else.
//   2. `tddLangFor("go")` returning undefined (phase 2 not registered yet)
//      fails the registration test and SKIPS everything else.
// Neither produces a wall of TypeErrors.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-go.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v31-go",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep both paths so a red run leaves nothing behind in the tree.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v31-go.entry.ts", ".blind-v31-go.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor, frameworkFor } = mod;

test("bundle: the seam surface builds and exports tddLangFor + frameworkFor [contract-seam.md 'New file: src/core/tddLang.ts']", () => {
  if (bundleError) {
    assert.fail(
      `bundle failed to build - the seam is not implemented yet: ${bundleError.message}`
    );
  }
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor is the one construction point");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor resolves the rung");
});

// Resolve the Go leg once. Its absence is the OTHER single loud failure.
let goLang;
let legError;
if (!bundleError) {
  try {
    goLang = tddLangFor("go");
  } catch (e) {
    legError = `tddLangFor("go") threw: ${e.message}`;
  }
  if (!legError && !goLang) {
    legError = 'tddLangFor("go") returned undefined: the phase 2 Go leg is not registered yet';
  }
}

test("REGISTRATION: tddLangFor('go') resolves a TddLang [contract-go.md 'Registers \"go\" in tddLangFor']", (ctx) => {
  if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
  assert.ok(!legError, legError || "");
  assert.strictEqual(typeof goLang, "object", "a TddLang is an object of members, not a factory");
});

// Every other test skips (not fails) while the bundle or the registration is
// broken, so a red run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the Go leg is not registered; see the REGISTRATION test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Shared fixtures. No module on disk anywhere: deps.fileExists is injected.
// ---------------------------------------------------------------------------

const ROOT = "/w/mod";
const GO_MOD = path.join(ROOT, "go.mod");

const SRC_PKG = path.join(ROOT, "pkg", "foo.go");
const TARGET_PKG = path.join(ROOT, "pkg", "foo_test.go");

const SRC_AT_ROOT = path.join(ROOT, "foo.go");
const TARGET_AT_ROOT = path.join(ROOT, "foo_test.go");

const SRC_NESTED = path.join(ROOT, "internal", "deep", "bar.go");

const ORPHAN = "/nowhere/loose.go";

// The source file's package line differs from its DIRECTORY name on purpose.
// contract-go.md: "The package name is the one declared by the source file ...
// Do not derive it from the directory name; they differ often enough to matter."
const SOURCE_TEXT =
  "// Package widgets aggregates fan-out counts.\n" +
  "package widgets\n" +
  "\n" +
  "// aggregateFanout returns the fan-out for n shards.\n" +
  "func aggregateFanout(n int) int {\n" +
  "\treturn n * 2\n" +
  "}\n";

// A virtual filesystem. `files` exist with no readable text; `texts` exist AND
// read back.
const goDeps = ({ files = [], texts = {} } = {}) => ({
  fileExists: (p) => files.includes(p) || Object.prototype.hasOwnProperty.call(texts, p),
  readFile: (p) => texts[p],
  readDir: () => undefined,
  log: () => {},
});

// The ordinary case: a go.mod at the module root, the source file, no sibling
// test file yet.
const MOD_DEPS = goDeps({ files: [GO_MOD, SRC_AT_ROOT, SRC_NESTED], texts: { [SRC_PKG]: SOURCE_TEXT } });
// Same, but foo_test.go is already on disk.
const MOD_DEPS_TARGET_EXISTS = goDeps({
  files: [GO_MOD, TARGET_PKG],
  texts: { [SRC_PKG]: SOURCE_TEXT },
});
// Nothing exists: no module root can be found.
const NO_MOD_DEPS = goDeps({});
// A module whose workspace root sits one directory above it.
const WORKSPACE_PARENT_DEPS = goDeps({
  files: [GO_MOD, "/w/go.work"],
  texts: { [SRC_PKG]: SOURCE_TEXT },
});
// A module with the workspace file beside its own go.mod. Also "inside a
// go.work workspace".
const WORKSPACE_SAME_DIR_DEPS = goDeps({
  files: [GO_MOD, path.join(ROOT, "go.work")],
  texts: { [SRC_PKG]: SOURCE_TEXT },
});

const placeOk = (filePath, symbol, deps) => {
  const res = goLang.placementFor(filePath, symbol, deps);
  assert.strictEqual(
    res.ok,
    true,
    `expected a placement for ${filePath}, got refusal ${JSON.stringify(res.refusal)}`
  );
  return res.placement;
};

// A duck-typed placement, so the command pins depend on buildCommand alone.
const goPlacement = (over = {}) => ({
  targetPath: TARGET_PKG,
  exists: false,
  mode: "sibling-file",
  runRoot: ROOT,
  packageArg: "./pkg",
  importLine: undefined,
  ...over,
});

const gotest = () => {
  assert.ok(Array.isArray(goLang.frameworks), "frameworks is an array in precedence order");
  assert.ok(goLang.frameworks.length > 0, "Go always has a rung: `testing` is in the standard library");
  return goLang.frameworks[0];
};

// `-run` may ride as two args or as `-run=<pattern>`. Both spell the same
// filter, so extract rather than pinning one encoding.
const runPatternOf = (cmd) => {
  const i = cmd.args.findIndex((a) => a === "-run" || a.startsWith("-run="));
  assert.ok(i >= 0, `the command carries a -run filter, got ${JSON.stringify(cmd.args)}`);
  const raw = cmd.args[i] === "-run" ? cmd.args[i + 1] : cmd.args[i].slice("-run=".length);
  assert.strictEqual(typeof raw, "string", "-run is followed by its pattern");
  return raw;
};

// Apply a TestInsertionPlan so the assertions read the RESULTING document,
// whether the plan carries the whole file or only the appended region.
const applyPlan = (existingText, plan) =>
  existingText.slice(0, plan.start) + plan.text + existingText.slice(plan.end);

// ---------------------------------------------------------------------------
// Runner fixtures, JSON-LINES. The rung moved from `go test -v` text to
// `go test -json` because the phase 2 review proved the text format forgeable
// BY THE CODE UNDER TEST. Every capture below is real output recorded in
// session-v31/scout-findings.md under "`go test -json`, measured after the
// phase 2 review found the text format forgeable", go1.26.5. Two fixtures are
// DERIVED rather than captured and say so on the line above them.
// ---------------------------------------------------------------------------

// THE FORGERY, captured. One real failure and one real pass. The failing test
// prints `--- PASS: TestPhantom` as part of its own message, which the TEXT
// parser read as a verdict for a test that does not exist.
const GO_JSON_FORGERY =
  '{"Action":"run","Package":"probe","Test":"TestInjectViaFailure"}\n' +
  '{"Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"    atlas_test.go:9: fanout(3) = line1\\n"}\n' +
  '{"Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"                --- PASS: TestPhantom (0.00s)\\n"}\n' +
  '{"Action":"fail","Package":"probe","Test":"TestInjectViaFailure","Elapsed":0}\n' +
  '{"Action":"run","Package":"probe","Test":"TestZero"}\n' +
  '{"Action":"pass","Package":"probe","Test":"TestZero","Elapsed":0}\n' +
  '{"Action":"output","Package":"probe","Output":"FAIL\\n"}\n' +
  '{"Action":"fail","Package":"probe","Elapsed":0.001}\n';

// THE FILTER MISS, captured, exit 0. Not one event carries a `Test` field.
const GO_JSON_FILTER_MISS =
  '{"Action":"output","Package":"probe","Output":"testing: warning: no tests to run\\n"}\n' +
  '{"Action":"output","Package":"probe","Output":"ok  \\tprobe\\t0.001s [no tests to run]\\n"}\n' +
  '{"Action":"pass","Package":"probe","Elapsed":0.002}\n';

// The same three events, terminal action FIRST and CRLF-terminated. A parser
// that keys off line position reads this differently, and one that does not
// strip the trailing \r fails every JSON.parse and silently reports nothing.
const GO_JSON_FILTER_MISS_SHUFFLED_CRLF =
  '{"Action":"pass","Package":"probe","Elapsed":0.002}\r\n' +
  '{"Action":"output","Package":"probe","Output":"ok  \\tprobe\\t0.001s [no tests to run]\\n"}\r\n' +
  '{"Action":"output","Package":"probe","Output":"testing: warning: no tests to run\\n"}\r\n';

// DERIVED from the capture above by deleting both output events: the structural
// minimum of a filter miss, a package terminal action with no Test-tagged run.
const GO_JSON_FILTER_MISS_BARE = '{"Action":"pass","Package":"probe","Elapsed":0.002}\n';

// DERIVED from the forgery capture, one Output string changed: a failing test
// whose own message contains the literal `[no tests to run]` tell. The review
// found the old text parser matched that tell unanchored against both streams
// with no `ran` gate.
const GO_JSON_TELL_INJECTED =
  '{"Action":"run","Package":"probe","Test":"TestInjectTheTell"}\n' +
  '{"Action":"output","Package":"probe","Test":"TestInjectTheTell","Output":"    atlas_test.go:9: banner(3) = ok  \\tprobe\\t0.001s [no tests to run]\\n"}\n' +
  '{"Action":"fail","Package":"probe","Test":"TestInjectTheTell","Elapsed":0}\n' +
  '{"Action":"output","Package":"probe","Output":"FAIL\\n"}\n' +
  '{"Action":"fail","Package":"probe","Elapsed":0.001}\n';

// DERIVED from the documented event schema: two failures running in parallel,
// so their output events INTERLEAVE and TestBeta terminates before TestAlpha.
// Any "buffer since the last run event" heuristic mis-attributes here. The
// contract claims the Test field deletes this whole class.
const GO_JSON_PARALLEL_INTERLEAVED =
  '{"Action":"run","Package":"probe","Test":"TestAlpha"}\n' +
  '{"Action":"run","Package":"probe","Test":"TestBeta"}\n' +
  '{"Action":"output","Package":"probe","Test":"TestAlpha","Output":"    alpha_test.go:8: alpha(1) = 1, want 11\\n"}\n' +
  '{"Action":"output","Package":"probe","Test":"TestBeta","Output":"    beta_test.go:9: beta(2) = 2, want 22\\n"}\n' +
  '{"Action":"fail","Package":"probe","Test":"TestBeta","Elapsed":0}\n' +
  '{"Action":"fail","Package":"probe","Test":"TestAlpha","Elapsed":0}\n' +
  '{"Action":"output","Package":"probe","Output":"FAIL\\n"}\n' +
  '{"Action":"fail","Package":"probe","Elapsed":0.002}\n';

// DERIVED from the forgery capture with unparseable lines interleaved: `go`
// chatter, a blank line, and a truncated object.
const GO_JSON_WITH_GARBAGE =
  "go: downloading github.com/spf13/cobra v1.8.0\n" +
  '{"Action":"run","Package":"probe","Test":"TestInjectViaFailure"}\n' +
  "\n" +
  "{not json at all\n" +
  '{"Action":"output","Package":"probe","Test":"TestInjectViaFailure","Output":"    atlas_test.go:9: fanout(3) = line1\\n"}\n' +
  '{"Action":"fail","Package":"probe","Test":"TestInjectViaFailure","Elapsed":0}\n' +
  '{"Action":"run","Package":"probe","Test":"TestZero"}\n' +
  '{"Action":"pass","Package":"probe","Test":"TestZero","Elapsed":0}\n';

// THE BUILD FAILURE, captured, exit 1. The compile error is on STDOUT as
// `build-output` events and STDERR IS EMPTY. The `...` is the elision in the
// recorded capture and is left exactly as recorded rather than filled in.
const GO_JSON_BUILD_FAILED_STDOUT =
  '{"ImportPath":"probe [probe.test]","Action":"build-output","Output":"./broke_test.go:6:14: cannot use \\"nope\\" ... \\n"}\n' +
  '{"ImportPath":"probe [probe.test]","Action":"build-fail"}\n' +
  '{"Action":"output","Package":"probe","Output":"FAIL\\tprobe [build failed]\\n"}\n' +
  '{"Action":"fail","Package":"probe","Elapsed":0,"FailedBuild":"probe [probe.test]"}\n';
const GO_JSON_BUILD_FAILED_STDERR = "";

// `[setup failed]` under `-json`, CAPTURED. Module requiring cobra with an
// empty GOMODCACHE and GOPROXY=off, stderr empty, exit 1. Note the shape it
// shares with the build failure above: build-output events, a build-fail, a
// package-scoped output event and a terminal fail carrying FailedBuild. The
// ONLY discriminator is the bracketed token.
const GO_JSON_SETUP_FAILED_STDOUT =
  '{"ImportPath":"github.com/spf13/cobra","Action":"build-output","Output":"atlas.go:3:8: missing go.sum entry for module providing package github.com/spf13/cobra (imported by probe2); to add:\\n"}\n' +
  '{"ImportPath":"github.com/spf13/cobra","Action":"build-output","Output":"\\tgo get probe2\\n"}\n' +
  '{"ImportPath":"github.com/spf13/cobra","Action":"build-fail"}\n' +
  '{"Action":"start","Package":"probe2"}\n' +
  '{"Action":"output","Package":"probe2","Output":"FAIL\\tprobe2 [setup failed]\\n"}\n' +
  '{"Action":"fail","Package":"probe2","Elapsed":0,"FailedBuild":"github.com/spf13/cobra"}\n';
const GO_JSON_SETUP_FAILED_STDERR = "";

// DERIVED from the capture above by deleting the build-output, build-fail,
// start and FailedBuild events: the bracketed token in a package-scoped output
// event, and nothing else. Pins that the TOKEN carries the verdict rather than
// the build markers that happen to accompany it.
const GO_JSON_SETUP_FAILED_MINIMAL =
  '{"Action":"output","Package":"probe2","Output":"FAIL\\tprobe2 [setup failed]\\n"}\n' +
  '{"Action":"fail","Package":"probe2","Elapsed":0}\n';

const DOC = "// aggregateFanout returns the fan-out for n shards.";

// ===========================================================================
// 1. The Go TddLang's shape.
// ===========================================================================

gtest("go TddLang: languageId is 'go' and displayName names Go [contract-seam.md 'readonly languageId'; 'Named in every refusal, e.g. \"Go\"']", () => {
  assert.strictEqual(goLang.languageId, "go", "the languageId round-trips the lookup key");
  assert.strictEqual(typeof goLang.displayName, "string", "displayName is a string");
  assert.ok(
    /go/i.test(goLang.displayName),
    `every refusal names the language, so displayName must say Go, got ${JSON.stringify(goLang.displayName)}`
  );
});

gtest("go TddLang: markerPrefix is '//' - one source of the marker format so scaffold and generatedTestNames cannot drift [contract-go.md '`markerPrefix` is `\"//\"`']", () => {
  assert.strictEqual(goLang.markerPrefix, "//", "Go comments the marker with //");
});

gtest("go TddLang: EXACTLY ONE framework, id 'gotest', and it always detects because `testing` is in the standard library [contract-go.md 'One entry, always detected ... No install, no config, nothing to look for']", () => {
  assert.strictEqual(
    goLang.frameworks.length,
    1,
    `Go has one rung and no alternatives to disambiguate, got ${JSON.stringify(goLang.frameworks.map((f) => f.id))}`
  );
  const fw = goLang.frameworks[0];
  assert.strictEqual(fw.id, "gotest", "the stable id is gotest");
  assert.strictEqual(typeof fw.displayName, "string", "displayName carries the honest-dark name");
  assert.strictEqual(fw.detect(ROOT, MOD_DEPS), true, "a resolved module root is all detection needs");

  const res = frameworkFor(goLang, ROOT, MOD_DEPS);
  assert.strictEqual(res.ok, true, "Go never goes honest-dark on framework detection");
  assert.strictEqual(res.framework.id, "gotest", "the resolved framework is gotest");
});

// ===========================================================================
// 2. Placement. Sibling file, module root, package argument.
//    [contract-go.md '## Placement']
// ===========================================================================

gtest("placementFor go: <root>/pkg/foo.go places tests in <root>/pkg/foo_test.go, mode 'sibling-file', runRoot the MODULE root [contract-go.md '`sibling-file`. For `<dir>/foo.go` the tests go in `<dir>/foo_test.go`'; '`runRoot` is the module root']", () => {
  const p = placeOk(SRC_PKG, "aggregateFanout", MOD_DEPS);
  assert.strictEqual(p.targetPath, TARGET_PKG, "the target is the _test.go sibling, not the source file");
  assert.strictEqual(p.mode, "sibling-file", "Go's tests are a sibling, unlike Rust's same-file module");
  assert.strictEqual(p.runRoot, ROOT, "go test runs from the module root, not the source directory");
});

gtest("placementFor go: packageArg is './pkg' for a file one directory below the module root, spelled with FORWARD SLASHES whatever the platform [contract-go.md '`./internal/foo` below it. Always forward slashes, whatever the platform']", () => {
  const p = placeOk(SRC_PKG, "aggregateFanout", MOD_DEPS);
  assert.strictEqual(p.packageArg, "./pkg", "the source directory relative to runRoot, as a Go relative package path");

  const nested = placeOk(SRC_NESTED, "widen", MOD_DEPS);
  assert.strictEqual(
    nested.packageArg,
    "./internal/deep",
    "a nested package keeps forward slashes; a backslash here is not a Go package path"
  );
  assert.ok(!nested.packageArg.includes("\\"), "no platform separator leaks into the package argument");
});

gtest("placementFor go: a file sitting AT the module root gives packageArg '.' [contract-go.md '`.` for the module root']", () => {
  const p = placeOk(SRC_AT_ROOT, "aggregateFanout", MOD_DEPS);
  assert.strictEqual(p.packageArg, ".", "the module root package is spelled `.`, not `./`");
  assert.strictEqual(p.targetPath, TARGET_AT_ROOT, "the sibling rule holds at the root too");
});

gtest("placementFor go: importLine is undefined - the generated file declares the SAME package, so it reaches unexported names with no import [contract-go.md '`importLine` is undefined ... it reaches unexported names with no import at all']", () => {
  const p = placeOk(SRC_PKG, "aggregateFanout", MOD_DEPS);
  assert.strictEqual(p.importLine, undefined, "same-package placement imports nothing to reach the unit under test");
});

gtest("placementFor go: `exists` tracks whether foo_test.go is already on disk [contract-go.md '`exists` is whether `foo_test.go` is already on disk']", () => {
  assert.strictEqual(
    placeOk(SRC_PKG, "aggregateFanout", MOD_DEPS).exists,
    false,
    "no sibling test file yet, so the gesture is creating one"
  );
  assert.strictEqual(
    placeOk(SRC_PKG, "aggregateFanout", MOD_DEPS_TARGET_EXISTS).exists,
    true,
    "the sibling exists, so the gesture is extending it"
  );
});

gtest("placementFor go: a file outside any go.mod refuses with reason 'no-project-root' and a detail NAMING go.mod [contract-go.md 'No module root means an honest refusal naming what is missing'; contract-seam.md 'it must NAME WHAT IS MISSING']", () => {
  const res = goLang.placementFor(ORPHAN, "widen", NO_MOD_DEPS);
  assert.strictEqual(res.ok, false, "no module root means the gesture cannot place a test");
  assert.strictEqual(res.refusal.reason, "no-project-root", "the enumerated reason, not free text");
  assert.ok(
    res.refusal.detail.includes("go.mod"),
    `the detail names the missing thing by name, got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.strictEqual(res.placement, undefined, "a refusal never smuggles a half-built placement through");
});

gtest("placementFor go: a module INSIDE a go.work workspace also refuses, and the detail must name go.work so the human is not left hunting a go.mod that is already correct [contract-go.md 'The go.work refusal is inherited, not new, and it must be SAID ... a detail that names `go.work` as the cause']", () => {
  for (const [label, deps] of [
    ["go.work one directory above the module", WORKSPACE_PARENT_DEPS],
    ["go.work beside the module's own go.mod", WORKSPACE_SAME_DIR_DEPS],
  ]) {
    const res = goLang.placementFor(SRC_PKG, "aggregateFanout", deps);
    assert.strictEqual(res.ok, false, `${label}: GoOracle refuses workspaces, so the TDD gesture refuses too`);
    assert.strictEqual(res.refusal.reason, "no-project-root", `${label}: the same enumerated reason`);
    assert.ok(
      res.refusal.detail.includes("go.work"),
      `${label}: the detail must say go.work is the cause, got ${JSON.stringify(res.refusal.detail)}`
    );
  }
});

// ===========================================================================
// 3. The command. THE SAFETY PIN.
//    [contract-go.md '### The command', three mandatory properties]
// ===========================================================================

gtest("gotest.buildCommand: command 'go', cwd the module root, and args carrying -json, the package arg and an ANCHORED -run filter - `-json` REPLACES `-v`, because the text format `-v` produces is forgeable by the code under test [contract-go.md '`go test -run '^(TestA|TestB)$' -json <packageArg>`'; '`-json` is not optional, and it REPLACES `-v`']", () => {
  const cmd = gotest().buildCommand(goPlacement(), ["TestA", "TestB"]);
  assert.strictEqual(cmd.command, "go", "the command is go, exactly");
  assert.strictEqual(cmd.cwd, ROOT, "cwd is the placement's runRoot, which for Go is the module root");
  assert.ok(Array.isArray(cmd.args), "args is an array, not a shell string");

  assert.ok(cmd.args.includes("test"), `the go subcommand is "test", got ${JSON.stringify(cmd.args)}`);
  assert.ok(
    cmd.args.includes("-json"),
    `-json is NOT optional: it carries the per-test structure that makes a verdict unforgeable, and the whole parse binds to it. Got ${JSON.stringify(cmd.args)}`
  );
  assert.ok(
    !cmd.args.includes("-v"),
    `-v is DROPPED: -json emits the same per-test output events, so -v is redundant, and shipping both invites a parser that falls back to the forgeable text. Got ${JSON.stringify(cmd.args)}`
  );
  assert.ok(
    cmd.args.includes("./pkg"),
    `the package argument rides through from the placement, got ${JSON.stringify(cmd.args)}`
  );

  const pattern = runPatternOf(cmd);
  assert.ok(pattern.includes("^("), `the filter is start-anchored, got ${JSON.stringify(pattern)}`);
  assert.ok(pattern.includes(")$"), `the filter is end-anchored, got ${JSON.stringify(pattern)}`);
  assert.ok(pattern.includes("TestA"), "the first name is in the filter");
  assert.ok(pattern.includes("TestB"), "the second name is in the filter");
  assert.ok(
    !pattern.includes("'"),
    `the pattern is a spawn argument, not a shell word: shell quotes inside it would be matched literally. Got ${JSON.stringify(pattern)}`
  );
});

gtest("gotest.buildCommand: the anchoring is a PROPERTY OF THE EMITTED REGEX - a superset name is excluded [contract-go.md 'Unanchored, `TestAggregateFanoutHappy` also matches the superset name']", () => {
  const cmd = gotest().buildCommand(goPlacement(), ["TestFoo"]);
  const re = new RegExp(runPatternOf(cmd));
  assert.strictEqual(re.test("TestFoo"), true, "the named test is selected");
  assert.strictEqual(
    re.test("TestFooBar"),
    false,
    "a superset name must NOT be selected: an unanchored filter silently runs tests the human never asked for, and their result is reported as this function's"
  );
  assert.strictEqual(re.test("XTestFoo"), false, "a prefixed name must not be selected either");
});

gtest("gotest.buildCommand: an empty testNames array must NEVER emit `^()$` - a filter that matches nothing is the false green this design guards against [contract-go.md 'An empty `testNames` array must never produce `-run '^()$'`. Refuse upstream instead']", () => {
  let cmd;
  try {
    cmd = gotest().buildCommand(goPlacement(), []);
  } catch (e) {
    // Throwing is a legitimate refusal. Nothing further to check.
    assert.ok(e instanceof Error, "a refusal by throw is an Error");
    return;
  }
  const joined = cmd.args.join(" ");
  assert.ok(
    !joined.includes("^()$"),
    `an empty-alternation filter selects nothing and exits 0, which is exactly the false green. Got ${JSON.stringify(cmd.args)}`
  );
});

// ===========================================================================
// 4. THE CENTREPIECE. A verdict is an Action carrying a Test field, and forged
//    text can only ever land inside an output event attributed to the real
//    test. The `go test -v` TEXT parser this replaces read an indented
//    `--- PASS: TestPhantom` inside a t.Errorf as a verdict for a test that
//    does not exist, and the injection channel was the generated shape itself.
//    [contract-go.md '### The parse: `go test -json`, NOT the text format']
// ===========================================================================

gtest("FORGERY: a `--- PASS: TestPhantom` line printed BY THE TEST produces NO case named TestPhantom, because a verdict is an Action carrying a Test field and forged text can only ever land inside an output event ATTRIBUTED to the real test [contract-go.md 'A forged verdict can only ever land inside an `Action: \"output\"` event's `Output` string, and that event is ATTRIBUTED to the real test by its `Test` field ... The two cannot be confused whatever the test prints']", () => {
  const p = gotest().parseOutput(GO_JSON_FORGERY, "", 1);

  const names = p.cases.map((c) => c.name);
  assert.ok(
    !names.includes("TestPhantom"),
    `TestPhantom does not exist. It is a string the failing test PRINTED, and the text parser counted it as a fourth case. Got cases ${JSON.stringify(p.cases)}`
  );
  assert.strictEqual(
    p.cases.length,
    2,
    `two tests ran, so there are two cases. The text parser produced four from this same run. Got ${JSON.stringify(p.cases)}`
  );
  assert.deepStrictEqual(
    names.slice().sort(),
    ["TestInjectViaFailure", "TestZero"],
    "only the two real tests, both named by their Test field"
  );
  assert.strictEqual(p.passed, 1, "the forged PASS must not inflate the passed count");
  assert.strictEqual(p.failed, 1, "one real failure");
  assert.ok(
    p.failures.every((f) => f.name !== "TestPhantom"),
    `a phantom must not acquire a failure entry either, got ${JSON.stringify(p.failures.map((f) => f.name))}`
  );
});

gtest("gotest.parseOutput: the captured failing run gives two named cases with the right outcomes, ran=true and casesComplete=true [contract-go.md '`cases`: `Action` of `pass` / `fail` / `skip` that carries a `Test` field'; '`ran`: any event carrying a `Test` field'; '`casesComplete: true`']", () => {
  const p = gotest().parseOutput(GO_JSON_FORGERY, "", 1);
  assert.strictEqual(p.ran, true, "events carry Test fields, so tests ran");
  assert.strictEqual(p.casesComplete, true, "go test enumerates passing tests, unlike C#");

  const byName = Object.fromEntries(p.cases.map((c) => [c.name, c.outcome]));
  assert.strictEqual(byName["TestInjectViaFailure"], "fail", "an Action of fail carrying a Test field is a failing case");
  assert.strictEqual(byName["TestZero"], "pass", "an Action of pass carrying a Test field is a passing case");
  assert.strictEqual(p.ignored, 0, "no skip actions");

  assert.strictEqual(p.failures.length, 1, "one failing test, one detail");
  const f = p.failures[0];
  assert.strictEqual(f.name, "TestInjectViaFailure", "the failure is named by its Test field");
  assert.ok(
    f.message.includes("fanout(3) = line1"),
    `the test's own output is the detail the human reads, got ${JSON.stringify(f.message)}`
  );
  assert.ok(
    p.filterMatchedNothing !== true,
    "a run that executed two tests is not a filter miss"
  );
});

gtest("gotest.parseOutput: the failure detail keeps the leading indentation carried in the Output strings, which is go's own framing and the human reads it [contract-go.md '`failures`: the `output` events for that `Test`, in order']", () => {
  const p = gotest().parseOutput(GO_JSON_FORGERY, "", 1);
  assert.ok(
    /^\s|\n\s/.test(p.failures[0].message),
    `the indented "    atlas_test.go:9:" framing survives, got ${JSON.stringify(p.failures[0].message)}`
  );
});

gtest("gotest.parseOutput: the bare `PASS` and bare `FAIL` traps stop existing BY CONSTRUCTION - both arrive as package-scoped output events with no Test field, so they are excluded by structure rather than by a rule someone must remember [contract-go.md 'The bare `PASS` and bare `FAIL` traps also stop existing']", () => {
  const fail = gotest().parseOutput(GO_JSON_FORGERY, "", 1);
  assert.strictEqual(fail.failed, 1, `the package-scoped "FAIL" output event is not a test, got ${JSON.stringify(fail.cases)}`);
  assert.strictEqual(fail.cases.length, 2, "two cases, not three");

  const miss = gotest().parseOutput(GO_JSON_FILTER_MISS, "", 0);
  assert.strictEqual(miss.passed, 0, `the package-scoped terminal pass is not a test, got ${JSON.stringify(miss.cases)}`);
  assert.deepStrictEqual(miss.cases, [], "no Test-tagged actions, so no cases");
});

gtest("gotest.parseOutput: with two failures INTERLEAVED by t.Parallel each gets ITS OWN detail - the Test field attributes every output line, so there is no backward buffering to contaminate [contract-go.md 'No backward buffering and no heuristic; the JSON already scopes every line to its test. This also deletes the parallel-output contamination the review found']", () => {
  const p = gotest().parseOutput(GO_JSON_PARALLEL_INTERLEAVED, "", 1);
  assert.strictEqual(p.failed, 2, "two Test-tagged fail actions");
  assert.strictEqual(p.failures.length, 2, "two failures, two details");

  const byName = Object.fromEntries(p.failures.map((f) => [f.name, f.message]));
  assert.ok(byName["TestAlpha"] !== undefined, `TestAlpha has a detail, got ${JSON.stringify(Object.keys(byName))}`);
  assert.ok(byName["TestBeta"] !== undefined, "TestBeta has a detail");

  assert.ok(byName["TestAlpha"].includes("want 11"), `TestAlpha keeps its own expected value, got ${JSON.stringify(byName["TestAlpha"])}`);
  assert.ok(
    !byName["TestAlpha"].includes("want 22"),
    `TestAlpha must not carry TestBeta's message: reporting a wrong expected value as fact is worse than reporting nothing. Got ${JSON.stringify(byName["TestAlpha"])}`
  );
  assert.ok(byName["TestBeta"].includes("want 22"), `TestBeta keeps its own expected value, got ${JSON.stringify(byName["TestBeta"])}`);
  assert.ok(
    !byName["TestBeta"].includes("want 11"),
    `TestBeta must not carry TestAlpha's message. Got ${JSON.stringify(byName["TestBeta"])}`
  );
});

gtest("gotest.parseOutput: a line that does not parse as JSON is SKIPPED, never thrown on, and the well-formed events around it still parse [contract-go.md 'One JSON object per line. A line that does not parse is SKIPPED, never thrown on: garbage tolerance']", () => {
  let p;
  assert.doesNotThrow(() => {
    p = gotest().parseOutput(GO_JSON_WITH_GARBAGE, "", 1);
  }, "go chatter and a truncated object must not throw");
  assert.strictEqual(p.cases.length, 2, `the two well-formed verdicts survive the noise around them, got ${JSON.stringify(p.cases)}`);
  assert.strictEqual(p.passed, 1);
  assert.strictEqual(p.failed, 1);
  assert.ok(p.failures[0].message.includes("fanout(3) = line1"), "the detail survives too");
});

// ===========================================================================
// 5. THE FALSE GREEN, now structural. `filterMatchedNothing` is a
//    package-level terminal action with zero Test-tagged run events. No regex,
//    nothing to forge.
//    [contract-go.md '### The false green needs no text tell at all']
// ===========================================================================

gtest("FALSE GREEN: a run that executed NOTHING has zero Test-tagged events, so the counts are 0 BY CONSTRUCTION and the `executed > 0` guard holds without any text tell to get wrong [contract-go.md 'Zero events carry a `Test` field, so the counts are 0 by construction and `filterMatchedNothing` is \"a package-level terminal action with zero `Test`-tagged run events\"']", () => {
  const p = gotest().parseOutput(GO_JSON_FILTER_MISS, "", 0);

  assert.strictEqual(p.passed, 0, `no Test-tagged pass action, so nothing passed. Got passed=${p.passed}, cases=${JSON.stringify(p.cases)}`);
  assert.strictEqual(p.failed, 0, "nothing failed either, because nothing ran");
  assert.strictEqual(p.passed + p.failed, 0, "executed is zero, so green must never be claimed");
  assert.deepStrictEqual(p.cases, [], "no Test-tagged verdicts, no cases");
  assert.deepStrictEqual(p.failures, [], "no failures");
  assert.strictEqual(p.ran, false, "ran is any event carrying a Test field, and there are none");

  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    "the human must read `the filter matched nothing` rather than a bare refusal, and that verdict now comes from event structure"
  );
});

gtest("FALSE GREEN: the same events REORDERED with the terminal action first and CRLF-terminated read identically - a parser that fails to strip the trailing \\r fails every JSON.parse and silently reports an empty run [contract-go.md 'A line that does not parse is SKIPPED']", () => {
  const p = gotest().parseOutput(GO_JSON_FILTER_MISS_SHUFFLED_CRLF, "", 0);
  assert.strictEqual(p.passed, 0, "a carriage return does not turn a package action into a passing test");
  assert.strictEqual(p.failed, 0);
  assert.deepStrictEqual(p.cases, [], "still no Test-tagged verdicts");
  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    "the verdict is structural, so event ORDER cannot lose it, and a trailing \\r must not defeat the JSON parse"
  );
});

gtest("FALSE GREEN: the `[no tests to run]` text is DECORATIVE now - a package terminal action with zero Test-tagged runs is a filter miss on its own, with no output events present at all [contract-go.md 'No regex, nothing to forge']", () => {
  const p = gotest().parseOutput(GO_JSON_FILTER_MISS_BARE, "", 0);
  assert.strictEqual(p.passed, 0, "no Test-tagged events");
  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    "the structure alone determines the verdict; the tell is for the message, not for the decision"
  );
});

gtest("FALSE GREEN, INVERTED: a failing test whose OWN OUTPUT contains the literal `[no tests to run]` must NOT set filterMatchedNothing - the review found the old tell matched unanchored across both streams with no `ran` gate, so a run that plainly matched something reported a filter miss [contract-go.md 'a failing test whose message contained the literal `[no tests to run]` set `filterMatchedNothing` on a run that plainly matched something']", () => {
  const p = gotest().parseOutput(GO_JSON_TELL_INJECTED, "", 1);
  assert.strictEqual(p.failed, 1, "a real test really failed");
  assert.strictEqual(p.cases.length, 1, `one real case, got ${JSON.stringify(p.cases)}`);
  assert.ok(
    p.filterMatchedNothing !== true,
    `the tell is inside an output event ATTRIBUTED to a real test, so it is that test's text and not a package verdict. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
});

// ===========================================================================
// 6. The build failure. It moves STREAM: the compile error is on stdout as
//    build-output events and stderr is EMPTY.
//    [contract-go.md '### The build failure moves stream']
// ===========================================================================

gtest("BUILD FAILURE: the compile error arrives on STDOUT as `build-output` events and STDERR IS EMPTY, so the error text must still be reachable in the parse - a parser that takes the build error off stderr reports a build failure with no message [contract-go.md 'The compile error arrives on STDOUT as `build-output` events and stderr is EMPTY ... Take it from the `build-output` events']", () => {
  const p = gotest().parseOutput(GO_JSON_BUILD_FAILED_STDOUT, GO_JSON_BUILD_FAILED_STDERR, 1);
  assert.strictEqual(GO_JSON_BUILD_FAILED_STDERR, "", "the fixture's stderr really is empty, which is the point of this row");

  const reachable = JSON.stringify(p);
  assert.ok(
    reachable.includes("broke_test.go:6:14"),
    `the compiler's own location must survive into the parse, or the human is told the build failed and nothing else. Got ${reachable}`
  );
  assert.ok(
    reachable.includes("cannot use"),
    `the compiler's own message must survive into the parse. Got ${reachable}`
  );
  assert.strictEqual(
    typeof p.buildError,
    "string",
    `the field the contract names for it is buildError, so the compile error is reachable by name and not only by trawling the object. Got ${JSON.stringify(p.buildError)}`
  );
});

gtest("BUILD FAILURE: ran=false, no fabricated cases, environmentError undefined (a compile error is NOT an environment error), and NOT a filter miss - the review found the old tell suppressed the compiler's message here [contract-go.md '### The build failure moves stream'; '`[setup failed]` is an environment error, not a compile error']", () => {
  const p = gotest().parseOutput(GO_JSON_BUILD_FAILED_STDOUT, GO_JSON_BUILD_FAILED_STDERR, 1);
  assert.strictEqual(p.ran, false, "no event carries a Test field, so no test binary ever ran");
  assert.deepStrictEqual(p.cases, [], "no Test-tagged verdicts, no fabricated cases");
  assert.strictEqual(p.passed, 0, "nothing passed");
  assert.strictEqual(p.failed, 0, "a compile error is not a test failure");
  assert.strictEqual(
    p.environmentError,
    undefined,
    `a compile error is not an environment error; the human's fix is in their own code, not their toolchain. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.ok(
    p.filterMatchedNothing !== true,
    `a build failure is not a filter miss. The review found the old unanchored tell firing here and SUPPRESSING the compiler's message, which sends the human to fix their filter while their code does not compile. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
});

// ===========================================================================
// 7. `[setup failed]`. An ENVIRONMENT error, not a compile error. The first
//    cut of this contract asserted environmentError never applies to Go, and
//    that was wrong.
//    [contract-go.md '### `[setup failed]` is an environment error']
// ===========================================================================

gtest("SETUP FAILED: the re-measured `-json` capture sets environmentError and NOT buildError, and the toolchain's own diagnosis is reachable - a cold module cache is not a compile error and the human's fix is not in their code [contract-go.md 'Set `environmentError` on the second, `buildError` on the first'; 'The tell arrives INSIDE a well-formed package-scoped `output` event, so the skip-unparseable-lines rule never discards it']", () => {
  const p = gotest().parseOutput(GO_JSON_SETUP_FAILED_STDOUT, GO_JSON_SETUP_FAILED_STDERR, 1);
  assert.strictEqual(GO_JSON_SETUP_FAILED_STDERR, "", "stderr is empty, so nothing here is reachable off the error stream");

  assert.strictEqual(
    typeof p.environmentError,
    "string",
    `without environmentError this lands as "the tests did not compile", which is the wrong sentence and points at the wrong fix. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.ok(p.environmentError.length > 0, "an empty environmentError says nothing");
  assert.strictEqual(
    p.buildError,
    undefined,
    `a cold module cache did not fail to COMPILE. Setting buildError here sends the human hunting a syntax error that does not exist. Got ${JSON.stringify(p.buildError)}`
  );

  assert.strictEqual(p.ran, false, "no event carries a Test field, so no test ran");
  assert.deepStrictEqual(p.cases, [], "no Test-tagged verdicts, no fabricated cases");
  assert.strictEqual(p.failed, 0, "a cold module cache is not a test failure");
  assert.ok(
    JSON.stringify(p).includes("go.sum"),
    `the toolchain's own diagnosis must be reachable, because the product may not run the "go get" it suggests and can only report it. Got ${JSON.stringify(p)}`
  );
});

gtest("SETUP FAILED: the bracketed token in a package-scoped output event is enough on its own, with no build-fail, no FailedBuild and no build-output events present [contract-go.md 'Read the `Output` field of package-scoped output events'; 'The discriminator between setup failure and compile failure is the bracketed token and nothing else']", () => {
  const p = gotest().parseOutput(GO_JSON_SETUP_FAILED_MINIMAL, "", 1);
  assert.strictEqual(
    typeof p.environmentError,
    "string",
    `the TOKEN carries the verdict, not the build markers that happen to accompany it. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.strictEqual(p.ran, false, "no Test-tagged events");
});

gtest("THE COLLISION, and it is live: a setup failure must NOT set filterMatchedNothing. A filter miss ends `Action: \"pass\"` at exit 0; a setup failure ends `Action: \"fail\"` at exit 1 with FailedBuild. Requiring only zero Test-tagged events tells a human with a cold module cache that their filter matched nothing [contract-go.md '`filterMatchedNothing` must therefore require the terminal action to be `pass`. Requiring only zero test events would tell a human with a cold module cache that their filter matched nothing']", () => {
  const fw = gotest();

  // The discriminator, pinned in BOTH directions off the same structural rule.
  const miss = fw.parseOutput(GO_JSON_FILTER_MISS, "", 0);
  assert.strictEqual(
    miss.filterMatchedNothing,
    true,
    "terminal action pass at exit 0 with zero Test-tagged events IS a filter miss"
  );

  for (const [label, out, exitCode] of [
    ["the full capture", GO_JSON_SETUP_FAILED_STDOUT, 1],
    ["the token alone", GO_JSON_SETUP_FAILED_MINIMAL, 1],
  ]) {
    const p = fw.parseOutput(out, GO_JSON_SETUP_FAILED_STDERR, exitCode);
    assert.ok(
      p.filterMatchedNothing !== true,
      `${label}: terminal action FAIL, so this is not a filter miss however many Test-tagged events are missing. Telling this human their filter matched nothing sends them to edit a filter that was never the problem. Got ${JSON.stringify(p.filterMatchedNothing)}`
    );
  }

  // A build failure ends `fail` too, so it must fall on the same side.
  const build = fw.parseOutput(GO_JSON_BUILD_FAILED_STDOUT, GO_JSON_BUILD_FAILED_STDERR, 1);
  assert.ok(
    build.filterMatchedNothing !== true,
    `a build failure also ends on a terminal fail and is also not a filter miss. Got ${JSON.stringify(build.filterMatchedNothing)}`
  );
});

gtest("`[build failed]` versus `[setup failed]`: both emit build-output and build-fail and ONLY the bracketed token differs, so the two must land in DIFFERENT fields - buildError for the compile error, environmentError for the environment [contract-go.md 'Both emit `build-fail` and `build-output`. A compile error says `[build failed]`; this says `[setup failed]`. Set `environmentError` on the second, `buildError` on the first']", () => {
  const fw = gotest();
  const build = fw.parseOutput(GO_JSON_BUILD_FAILED_STDOUT, GO_JSON_BUILD_FAILED_STDERR, 1);
  const setup = fw.parseOutput(GO_JSON_SETUP_FAILED_STDOUT, GO_JSON_SETUP_FAILED_STDERR, 1);

  assert.strictEqual(
    typeof build.buildError,
    "string",
    `"[build failed]" is a compile error and carries the compiler's message in buildError. Got ${JSON.stringify(build.buildError)}`
  );
  assert.strictEqual(
    build.environmentError,
    undefined,
    `the human's toolchain is fine; their code does not compile. Got ${JSON.stringify(build.environmentError)}`
  );

  assert.strictEqual(
    typeof setup.environmentError,
    "string",
    `"[setup failed]" is an environment error. Got ${JSON.stringify(setup.environmentError)}`
  );
  assert.strictEqual(
    setup.buildError,
    undefined,
    `the human's code is fine; their module cache is cold. Got ${JSON.stringify(setup.buildError)}`
  );

  // The two are not merely different fields, they carry different text.
  assert.ok(build.buildError.includes("cannot use"), `the compile error text lands in buildError, got ${JSON.stringify(build.buildError)}`);
  assert.ok(
    setup.environmentError.includes("go.sum"),
    `the missing-go.sum diagnosis lands in environmentError, got ${JSON.stringify(setup.environmentError)}`
  );
});

gtest("gotest.parseOutput: garbage and empty input give a did-not-run result and NEVER throw [contract-seam.md 'ran: boolean'; contract-go.md 'A line that does not parse is SKIPPED, never thrown on']", () => {
  const fw = gotest();
  for (const [label, out, err, exit] of [
    ["empty", "", "", 0],
    ["non-json noise", "some tool said something weird\n{not json}\n", "", 1],
    ["arbitrary bytes", " ￿\n\n\t garbage", "", 1],
    ["stderr only", "", "go: cannot find main module\n", 1],
    ["a truncated json line", '{"Action":"run","Package":"probe"', "", 1],
  ]) {
    let p;
    assert.doesNotThrow(() => {
      p = fw.parseOutput(out, err, exit);
    }, `${label}: parseOutput never throws`);
    assert.strictEqual(p.ran, false, `${label}: no Test-tagged events means nothing ran`);
    assert.strictEqual(p.passed, 0, `${label}: zero passed`);
    assert.strictEqual(p.failed, 0, `${label}: zero failed`);
    assert.strictEqual(typeof p.casesComplete, "boolean", `${label}: casesComplete is always present`);
  }
});

// ===========================================================================
// 8. returnTypeOf. The shipped `-> ` regex returns undefined for every Go
//    function, which is why the gesture would otherwise report "returns no
//    value to assert" on all of Go.
//    [contract-go.md '## `returnTypeOf`']
// ===========================================================================

gtest("returnTypeOf go: the contract's table, row for row [contract-go.md '## `returnTypeOf`' table]", () => {
  const table = [
    ["func f(a int) int {", "int"],
    ["func f(a int) (int, error)", "(int, error)"],
    ["func f(a int) (n int, err error)", "(n int, err error)"],
    ["func f(a int)", undefined],
    ["func f(a int) {", undefined],
  ];
  for (const [sig, want] of table) {
    assert.strictEqual(
      goLang.returnTypeOf(sig),
      want,
      `${JSON.stringify(sig)} yields ${JSON.stringify(want)}`
    );
  }
});

gtest("returnTypeOf go: THE TWO A NAIVE REGEX BREAKS - a pointer receiver and a function-typed parameter both need the MATCHING close paren, not indexOf(')') [contract-go.md 'The last two are the ones a naive regex gets wrong. Find the parameter list's MATCHING close paren by depth counting']", () => {
  assert.strictEqual(
    goLang.returnTypeOf("func (s *Shard) M(a int) string"),
    "string",
    "a pointer receiver adds a paren group BEFORE the parameter list; the first `)` is the receiver's"
  );
  assert.strictEqual(
    goLang.returnTypeOf("func f(a func(int) int) string"),
    "string",
    "a function-typed parameter nests a `)` INSIDE the parameter list; the first `)` is the inner one"
  );
  assert.strictEqual(
    goLang.returnTypeOf("func (s *Shard) M(a func(int) int) (int, error) {"),
    "(int, error)",
    "both wrinkles at once still yields the real return type"
  );
});

// ===========================================================================
// 9. Testability, first-match-wins.
//    [contract-go.md '## Testability': async -> io -> needs-fixture ->
//     underspecified -> testable]
// ===========================================================================

gtest("classifyTestability go: a `chan` type or a `context.Context` parameter is 'async' - Go has no async keyword, these are the equivalents [contract-go.md 'The equivalents are a `chan` type in the signature, or a `context.Context` parameter']", () => {
  for (const sig of [
    "func drain(c chan int) int",
    "func drain(c <-chan int) int",
    "func fanout(n int) chan int",
    "func fetch(ctx context.Context, id int) int",
  ]) {
    assert.strictEqual(
      goLang.classifyTestability(sig, DOC).reason,
      "async",
      `${JSON.stringify(sig)} is Go's async shape`
    );
  }
});

gtest("classifyTestability go: an `os.File` and an `http.ResponseWriter` in the signature are 'io' - the `http.` marker is a MEASURED CORRECTION, ten of Go's 104 survivors carried one [goal.md Amendment 1 'Go's io marker set in item 2 misses `net/http`, which is imported as `http`']", () => {
  for (const sig of [
    "func dump(fh *os.File) int",
    "func dial(c net.Conn) int",
    "func slurp(r io.Reader) string",
    "func scan(r *bufio.Reader) string",
    "func handle(w http.ResponseWriter, id int) string",
    "func route(r *http.Request) string",
  ]) {
    assert.strictEqual(
      goLang.classifyTestability(sig, DOC).reason,
      "io",
      `${JSON.stringify(sig)} touches the world and is integration territory dressed as a survivor`
    );
  }
});

gtest("classifyTestability go: a method receiver is 'needs-fixture' - constructing a meaningful receiver is the fixture problem this gesture does not attempt [contract-go.md 'a method receiver, `func (s *Shard) M()` ... Measured as Go's largest refusal at 60.6%']", () => {
  for (const sig of ["func (s *Shard) Total(a int) int", "func (s Shard) Total(a int) int"]) {
    assert.strictEqual(
      goLang.classifyTestability(sig, DOC).reason,
      "needs-fixture",
      `${JSON.stringify(sig)} needs an instance the blind test cannot construct`
    );
  }
});

gtest("classifyTestability go: no doc comment is 'underspecified', and so is three or more return values [contract-go.md 'no doc comment; or no return value; or three or more return values']", () => {
  assert.strictEqual(
    goLang.classifyTestability("func aggregateFanout(n int) int", undefined).reason,
    "underspecified",
    "with no contract there is nothing to write a blind test against"
  );
  assert.strictEqual(
    goLang.classifyTestability("func aggregateFanout(n int) int", "").reason,
    "underspecified",
    "an empty doc comment is no doc comment"
  );
  assert.strictEqual(
    goLang.classifyTestability("func aggregateFanout(n int)", DOC).reason,
    "underspecified",
    "no return value means nothing to assert on"
  );
  assert.strictEqual(
    goLang.classifyTestability("func split(n int) (int, string, error)", DOC).reason,
    "underspecified",
    "three or more returns, which cost exactly one function across cobra and gin, so the rule is cheap and stays"
  );
});

gtest("classifyTestability go: `(T, error)` with a doc comment IS TESTABLE - blank the T, the error is asserted separately [contract-go.md '`(T, error)` is TESTABLE']", () => {
  assert.strictEqual(
    goLang.classifyTestability("func parseShard(s string) (int, error)", DOC).reason,
    undefined,
    "a two-value return with an error is the canonical Go testable shape, not a refusal"
  );
  assert.strictEqual(
    goLang.classifyTestability("func aggregateFanout(n int) int", DOC).reason,
    undefined,
    "the plain documented value-returning function is not refused"
  );
});

gtest("classifyTestability go: a doc comment that does NOT start with the function name is still a contract [contract-go.md 'Go's own convention is that a doc comment starts with the function name. Do not require it']", () => {
  assert.strictEqual(
    goLang.classifyTestability("func aggregateFanout(n int) int", "// Returns the fan-out for n shards.").reason,
    undefined,
    "the convention is not enforced; a comment that breaks it still specifies the contract"
  );
});

gtest("classifyTestability go: first-match-wins precedence holds, so the reported reason is stable [contract-go.md 'Same first-match-wins precedence as Rust so the reported reason is stable']", () => {
  assert.strictEqual(
    goLang.classifyTestability("func (s *Shard) Fetch(ctx context.Context) int", DOC).reason,
    "async",
    "async precedes needs-fixture, so a method taking a context reports async"
  );
  assert.strictEqual(
    goLang.classifyTestability("func (s *Shard) Dump(fh *os.File) int", DOC).reason,
    "io",
    "io precedes needs-fixture"
  );
  assert.strictEqual(
    goLang.classifyTestability("func (s *Shard) Total(a int) int", undefined).reason,
    "needs-fixture",
    "needs-fixture precedes underspecified, so a doc-less method reports the fixture problem"
  );
});

gtest("classifyTestability go: 'not-exported' NEVER fires for ANY Go input, lowercase names included - the `_test.go` sibling declares the same package and sees unexported names [contract-go.md '`not-exported` must never fire ... An unexported function is a first-class target here']", () => {
  const signatures = [
    // The measured unexported survivors from cobra and gin.
    "func rpad(s string, padding int) string",
    "func safeUint16(n int) uint16",
    "func getMapFromFormData(m map[string][]string) map[string]string",
    // Ordinary lowercase and uppercase forms.
    "func aggregateFanout(n int) int",
    "func AggregateFanout(n int) int",
    "func parseShard(s string) (int, error)",
    // The refused shapes, which must be refused for their OWN reason.
    "func (s *Shard) total(a int) int",
    "func drain(c chan int) int",
    "func dump(fh *os.File) int",
    "func noop(a int)",
    "",
  ];
  for (const sig of signatures) {
    for (const doc of [DOC, undefined]) {
      assert.notStrictEqual(
        goLang.classifyTestability(sig, doc).reason,
        "not-exported",
        `${JSON.stringify(sig)} (doc: ${doc ? "yes" : "no"}) must never be refused as not-exported; that reason belongs to TypeScript and C# only`
      );
    }
  }
});

// ===========================================================================
// 10. testNameIsValid. A name go test silently ignores is a false green
//     wearing a different hat.
//     [contract-go.md '## Test names': /^Test[A-Z_]/]
// ===========================================================================

gtest("testNameIsValid go: `Test` plus an uppercase letter or an underscore, or go test silently never runs the function [contract-go.md '`testNameIsValid`: `/^Test[A-Z_]/` ... a badly named generated test is silently never run, which is a false green wearing a different hat']", () => {
  assert.strictEqual(typeof goLang.testNameIsValid, "function", "Go constrains test names, so the optional member is present");
  const valid = ["TestFoo", "Test_foo", "TestAggregateFanoutHappy", "TestA"];
  const invalid = ["testFoo", "Testfoo", "Foo", "Test", "Test1", "XTestFoo", ""];
  for (const name of valid) {
    assert.strictEqual(goLang.testNameIsValid(name), true, `${JSON.stringify(name)} is run by go test`);
  }
  for (const name of invalid) {
    assert.strictEqual(
      goLang.testNameIsValid(name),
      false,
      `${JSON.stringify(name)} is SILENTLY IGNORED by go test, so generating it hands the human a green that never ran`
    );
  }
});

// ===========================================================================
// 11. expectedValueSpans. THE SAFETY-CRITICAL ONE.
//     Get the locator wrong and the product blanks the call under test and
//     keeps the model's guess, which inverts the blank-value invariant.
//     [contract-go.md '`expectedValueSpans` returns the right-hand side of each
//      `want :=` assignment, and nothing else']
// ===========================================================================

const spanTexts = (fw, text) => {
  const spans = fw.expectedValueSpans(text);
  assert.ok(Array.isArray(spans), "expectedValueSpans returns an array");
  return spans.map((s) => text.slice(s.start, s.end));
};

const GENERATED_BODY =
  "func TestAggregateFanoutHappy(t *testing.T) {\n" +
  "\tgot := aggregateFanout(3)\n" +
  "\twant := 7\n" +
  "\tif got != want {\n" +
  '\t\tt.Errorf("aggregateFanout(3) = %v, want %v", got, want)\n' +
  "\t}\n" +
  "}\n";

gtest("expectedValueSpans go: EXACTLY ONE span, and it covers the `want :=` right-hand side, NOT the call under test and NOT `got` [contract-go.md 'It must not match `got :=`'; goal.md item 6 'Getting the argument order wrong blanks the call under test and keeps the model's guess']", () => {
  const fw = gotest();
  const spans = fw.expectedValueSpans(GENERATED_BODY);
  assert.strictEqual(
    spans.length,
    1,
    `one "want :=" in this body, one span, got ${JSON.stringify(spans.map((s) => GENERATED_BODY.slice(s.start, s.end)))}`
  );
  const covered = GENERATED_BODY.slice(spans[0].start, spans[0].end);
  assert.strictEqual(covered, "7", `the span is the expected VALUE, got ${JSON.stringify(covered)}`);
  assert.ok(
    !covered.includes("aggregateFanout"),
    "blanking the call under test would delete the thing being tested and keep the model's guess as the expectation"
  );
  assert.ok(!covered.includes("got"), "the actual value is not a hole; the human types the expectation only");
});

gtest("expectedValueSpans go: a `want` inside a double-quoted string or a `//` comment produces NO span [contract-go.md 'must not match a `want` inside a string or comment']", () => {
  const fw = gotest();

  const inString =
    "func TestStringDecoy(t *testing.T) {\n" +
    '\tmsg := "want := 99"\n' +
    "\tif msg == \"\" {\n" +
    "\t\tt.Errorf(\"empty\")\n" +
    "\t}\n" +
    "}\n";
  assert.deepStrictEqual(
    spanTexts(fw, inString),
    [],
    "a want inside a string literal is text, not an assignment"
  );

  const inComment =
    "func TestCommentDecoy(t *testing.T) {\n" +
    "\t// want := 42\n" +
    "\t/* want := 43 */\n" +
    "\tgot := widen(2)\n" +
    "\tif got != 0 {\n" +
    "\t\tt.Errorf(\"x\")\n" +
    "\t}\n" +
    "}\n";
  assert.deepStrictEqual(
    spanTexts(fw, inComment),
    [],
    "a want inside a line or block comment is prose, not an assignment"
  );
});

gtest("expectedValueSpans go: GO'S OWN WRINKLE - inside a raw backtick string a backslash is NOT an escape, so a raw string ending in a backslash must still terminate at its backtick [contract-go.md 'raw backtick strings, in which backslashes are not escapes. That last one is Go's own wrinkle and the profile must carry it']", () => {
  const fw = gotest();
  // `sep` ends in a backslash. A scanner that applies backslash escaping inside
  // backticks consumes the closing backtick as escaped, runs on into the next
  // raw string, and ends up with the real `want := 5` swallowed inside a string.
  // Correct handling gives exactly one span.
  const rawBody =
    "func TestRawString(t *testing.T) {\n" +
    "\tsep := `\\`\n" +
    "\ttmpl := `raw want := 99 stays raw`\n" +
    "\tgot := join(sep, tmpl)\n" +
    "\twant := 5\n" +
    "\tif got != want {\n" +
    '\t\tt.Errorf("join = %v, want %v", got, want)\n' +
    "\t}\n" +
    "}\n";
  const texts = spanTexts(fw, rawBody);
  assert.deepStrictEqual(
    texts,
    ["5"],
    `exactly one span, on the real want. A backslash-escaping scanner either swallows it (zero spans) or surfaces the raw string's decoy 99. Got ${JSON.stringify(texts)}`
  );
});

gtest("expectedValueSpans go: spans come back ASCENDING and NON-OVERLAPPING [goal.md item 6 'exactly the byte ranges the human must type']", () => {
  const fw = gotest();
  const twoTests =
    "func TestAlpha(t *testing.T) {\n" +
    "\tgot := alpha(1)\n" +
    "\twant := 11\n" +
    "\tif got != want {\n" +
    '\t\tt.Errorf("alpha(1) = %v, want %v", got, want)\n' +
    "\t}\n" +
    "}\n" +
    "\n" +
    "func TestBeta(t *testing.T) {\n" +
    "\tgot := beta(2)\n" +
    "\twant := 22\n" +
    "\tif got != want {\n" +
    '\t\tt.Errorf("beta(2) = %v, want %v", got, want)\n' +
    "\t}\n" +
    "}\n";
  const spans = fw.expectedValueSpans(twoTests);
  assert.strictEqual(spans.length, 2, `two "want :=" assignments, two spans, got ${JSON.stringify(spans)}`);
  assert.deepStrictEqual(
    spans.map((s) => twoTests.slice(s.start, s.end)),
    ["11", "22"],
    "each span covers its own expected value"
  );
  for (const s of spans) {
    assert.ok(s.end > s.start, `a span is a non-empty range, got ${JSON.stringify(s)}`);
  }
  assert.ok(
    spans[1].start >= spans[0].end,
    `ascending and non-overlapping: a consumer applies these in order and overlapping ranges corrupt the document. Got ${JSON.stringify(spans)}`
  );
});

// ===========================================================================
// 12. renderBlankValue. Scaffold what the TYPE determines, keep as ONE hole
//     what the CONTRACT determines.
//     [contract-go.md '## Blank values']
// ===========================================================================

const blank = (type) => {
  const res = goLang.renderBlankValue(type);
  assert.strictEqual(typeof res.holes, "number", `renderBlankValue(${JSON.stringify(type)}) reports a hole count`);
  assert.strictEqual(typeof res.rhs, "string", `renderBlankValue(${JSON.stringify(type)}) renders a right-hand side`);
  return res;
};

gtest("renderBlankValue go: a scalar is ONE BARE hole, `${1}` with NO type-hint comment - the bare side of the bare-versus-hinted rule [contract-go.md 'a SCALAR gets a bare hole, and everything else gets a hole carrying a type-hint comment'; '`int`, `int8`…`uint64`, ... | one BARE hole, `${1}`']", () => {
  for (const type of ["int", "int8", "uint64", "float32", "float64", "string", "bool", "byte", "rune"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.strictEqual(
      res.rhs,
      "${1}",
      `${type}: a scalar's own name is no help to the human, so the hole carries no comment. Got ${JSON.stringify(res.rhs)}`
    );
    assert.ok(
      !res.rhs.includes("/*"),
      `${type}: no type-hint comment on a scalar, got ${JSON.stringify(res.rhs)}`
    );
  }
});

gtest("renderBlankValue go: `[]T` and `map[K]V` SCAFFOLD their literal, and the contents are ONE HINTED hole carrying the ELEMENT type [contract-go.md '`[]T` | `[]T{${1:/* T */}}`, contents one HINTED hole'; '`map[K]V` | `map[K]V{${1:/* K, V */}}`'; 'Container contents are hinted with the element type']", () => {
  const slice = blank("[]int");
  assert.strictEqual(slice.holes, 1, "the slice literal is scaffolded, the contents are one hole");
  assert.ok(slice.rhs.startsWith("[]int{"), `the type scaffolds its own literal, got ${JSON.stringify(slice.rhs)}`);
  assert.ok(slice.rhs.endsWith("}"), `the literal is closed, got ${JSON.stringify(slice.rhs)}`);
  assert.ok(
    slice.rhs.includes("${1:/* int */}"),
    `the contents hole hints the ELEMENT type, not the container type: the human is typing an int, not a []int. Got ${JSON.stringify(slice.rhs)}`
  );

  const m = blank("map[string]int");
  assert.strictEqual(m.holes, 1, "the map literal is scaffolded, the contents are one hole");
  assert.ok(m.rhs.startsWith("map[string]int{"), `the map type scaffolds its own literal, got ${JSON.stringify(m.rhs)}`);
  assert.ok(m.rhs.endsWith("}"), `the literal is closed, got ${JSON.stringify(m.rhs)}`);
  assert.ok(
    /\$\{1:\/\*[^*]*\bstring\b[^*]*\bint\b[^*]*\*\/\}/.test(m.rhs),
    `the contents hole hints BOTH the key and the value type, got ${JSON.stringify(m.rhs)}`
  );
});

gtest("renderBlankValue go: `error` is ONE HINTED hole - the variant IS the answer, and the Option/Result precedent it is cited to is hinted, not bare [contract-go.md '`error` | one HINTED hole, `${1:/* error */}` ... that precedent is hinted'; 'renderBlankValue(\"Option<u32>\") -> ${1:/* Option<u32> */}']", () => {
  const res = blank("error");
  assert.strictEqual(res.holes, 1, "nil or a specific error is a contract choice, not a type-determined scaffold");
  assert.strictEqual(
    res.rhs,
    "${1:/* error */}",
    `error is not a scalar, so it follows the everything-else rule and carries its type hint. Got ${JSON.stringify(res.rhs)}`
  );
});

gtest("renderBlankValue go: a named struct, a pointer and an interface are ONE HINTED hole naming the type [contract-go.md 'a named struct, an interface, a pointer | one HINTED hole'; 'renderBlankValue(\"MyStruct\") -> ${1:/* MyStruct */}']", () => {
  for (const [type, hinted] of [
    ["Shard", "Shard"],
    ["*Shard", "Shard"],
    ["io.Writer", "io.Writer"],
  ]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.ok(res.rhs.includes("${1:/*"), `${type}: the hole carries a type-hint comment, got ${JSON.stringify(res.rhs)}`);
    assert.ok(
      res.rhs.includes(hinted),
      `${type}: the hint names the type so the human knows what to construct, got ${JSON.stringify(res.rhs)}`
    );
  }
});

// ===========================================================================
// 13. Scaffold. The package name comes from the SOURCE file, not the directory.
//     [contract-go.md '## Scaffold']
// ===========================================================================

const GENERATED_TESTS =
  "func TestAggregateFanoutHappy(t *testing.T) {\n" +
  "\tgot := aggregateFanout(3)\n" +
  "\twant := 7\n" +
  "\tif got != want {\n" +
  '\t\tt.Errorf("aggregateFanout(3) = %v, want %v", got, want)\n' +
  "\t}\n" +
  "}\n";

const MARKER_ID = "aggregateFanout-1";

// deps ride along on the input as well as through placementFor, so the leg can
// read the source package line by either route. Extra properties are ignored.
const scaffoldFor = (existingText, deps) => {
  const placement = placeOk(SRC_PKG, "aggregateFanout", deps);
  const plan = goLang.scaffold({
    existingText,
    generatedTests: GENERATED_TESTS,
    markerId: MARKER_ID,
    placement,
    deps,
  });
  assert.strictEqual(typeof plan.start, "number", "start is an offset into the target document");
  assert.strictEqual(typeof plan.end, "number", "end is an offset into the target document");
  assert.ok(plan.end >= plan.start, "the replaced range is not inverted");
  assert.strictEqual(typeof plan.text, "string", "text is what gets written");
  return plan;
};

gtest("scaffold go: a NEW file declares the package the SOURCE FILE declares, not the directory name [contract-go.md 'The package name is the one declared by the source file, read from its `package` line. Do not derive it from the directory name']", () => {
  const plan = scaffoldFor("", MOD_DEPS);
  const out = applyPlan("", plan);
  assert.ok(
    /^\s*package\s+widgets\b/m.test(out),
    `the source file declares "package widgets" while its directory is "pkg"; the scaffold must follow the source. Got ${JSON.stringify(out.slice(0, 200))}`
  );
  assert.ok(
    !/\bpackage\s+pkg\b/.test(out),
    "deriving the package from the directory name produces a file that does not compile"
  );
  assert.ok(
    !/\bpackage\s+widgets_test\b/.test(out),
    "package foo_test is the black-box convention and would hide the unexported majority case"
  );
});

gtest("scaffold go: a NEW file imports `testing` and fences the generated functions in begin/end markers commented with markerPrefix [contract-go.md 'import \"testing\"'; '// column80-tests:<id>:begin ... :end']", () => {
  const plan = scaffoldFor("", MOD_DEPS);
  const out = applyPlan("", plan);

  assert.ok(/\bimport\b/.test(out), `the file imports something, got ${JSON.stringify(out)}`);
  assert.ok(out.includes('"testing"'), "the testing package is imported, or `t *testing.T` does not resolve");

  for (const suffix of ["begin", "end"]) {
    const marker = `column80-tests:${MARKER_ID}:${suffix}`;
    assert.ok(out.includes(marker), `the ${suffix} marker is present, got ${JSON.stringify(out)}`);
    const line = out.split("\n").find((l) => l.includes(marker));
    assert.ok(
      line.trim().startsWith(goLang.markerPrefix),
      `the ${suffix} marker is a comment using markerPrefix, got ${JSON.stringify(line)}`
    );
  }

  const begin = out.indexOf(`column80-tests:${MARKER_ID}:begin`);
  const fnAt = out.indexOf("func TestAggregateFanoutHappy");
  const end = out.indexOf(`column80-tests:${MARKER_ID}:end`);
  assert.ok(fnAt > begin && fnAt < end, "the generated function sits INSIDE the fence, or the region cannot be replaced later");
});

gtest("scaffold go: extending a file that ALREADY imports `testing` must not add a duplicate import [contract-go.md 'An import block that already has \"testing\" must not gain a duplicate']", () => {
  const existing =
    "package widgets\n" +
    "\n" +
    'import "testing"\n' +
    "\n" +
    "func TestHumanWroteThis(t *testing.T) {\n" +
    "\tif 1 != 1 {\n" +
    '\t\tt.Errorf("impossible")\n' +
    "\t}\n" +
    "}\n";
  const plan = scaffoldFor(existing, MOD_DEPS_TARGET_EXISTS);
  assert.strictEqual(
    plan.mode,
    "extend-existing",
    `no marked region exists, so the plan appends one, got ${JSON.stringify(plan.mode)}`
  );
  const out = applyPlan(existing, plan);

  const importCount = out.split('"testing"').length - 1;
  assert.strictEqual(
    importCount,
    1,
    `a duplicate import is a compile error, so the human's accepted file would not build. Got ${importCount} occurrences in ${JSON.stringify(out)}`
  );
  assert.ok(out.includes("TestHumanWroteThis"), "the developer's own test survives untouched");
  assert.ok(out.includes("TestAggregateFanoutHappy"), "the generated test rides into the plan");
  assert.ok(
    out.includes(`column80-tests:${MARKER_ID}:begin`),
    "the appended region is fenced so it can be replaced next time"
  );
});

gtest("scaffold go: generatedTestNames reads back exactly the names inside the marked region, so scaffold and the rung's filter cannot drift [contract-go.md 'The marker format is shared with `generatedTestNames`, which reads `func\\s+(Test\\w+)` inside the marked region']", () => {
  const plan = scaffoldFor("", MOD_DEPS);
  const out = applyPlan("", plan);
  const names = goLang.generatedTestNames(out, MARKER_ID);
  assert.deepStrictEqual(
    names,
    ["TestAggregateFanoutHappy"],
    `the round trip recovers the generated name, got ${JSON.stringify(names)}`
  );
  assert.deepStrictEqual(
    goLang.generatedTestNames(out, "some-other-id"),
    [],
    "a different markerId sees none of this region's tests"
  );
});
