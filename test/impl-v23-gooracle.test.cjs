// Impl oracle for GoOracle (v23): the internals the blind contract set cannot
// see from the CompilerOracle surface alone —
//   * the concatenated-JSON scanner behind fileCovered (strings holding
//     braces, a garbled object skipped, not a crashed probe)
//   * the go-info line filter (`go: downloading ...` is progress, never a
//     span-less failure diagnostic)
//   * continuation-line folding edges (leading continuation with no prior
//     diagnostic is dropped; rendered keeps the raw lines)
//   * the column-less `path.go:line: message` diagnostic form
//   * resolveDiagnosticPath's exists-check fallback branch
//   * the diagnosticsOnStderr spawn seam: the stderr evidence cap stays for
//     unflagged commands and lifts for flagged ones (real spawns, no go)
//
// The blind file (blind-v23-gooracle*.test.cjs) owns the external contract;
// this file owns the mechanism.
//
// Run: SKIP_LIVE=1 node --test test/impl-v23-gooracle.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v23-gooracle",
  `export { GoOracle } from "../src/core/compilerOracle";\n`,
);
test.after(() => cleanup());
const { GoOracle } = mod;

// ---------------------------------------------------------------------------
// fileCovered's concatenated-JSON scanner

const pkgJson = (dir, fields) =>
  JSON.stringify({ Dir: dir, ...fields }, null, "\t");

test("fileCovered: a string value holding braces never desyncs the object scanner [mechanism: depth scan is string-aware]", () => {
  const o = new GoOracle();
  const root = "/m";
  const stream =
    pkgJson("/m", { GoFiles: ["main.go"], Doc: 'has "{{weird}}" braces }{' }) +
    "\n" +
    pkgJson("/m/lib", { GoFiles: ["lib.go"] });
  assert.strictEqual(o.fileCovered(stream, root, "/m/lib/lib.go"), true, "second object still parsed");
});

test("fileCovered: a garbled object yields fewer packages, never a crashed probe [mechanism: per-object parse failure is skipped]", () => {
  const o = new GoOracle();
  const stream = '{"Dir": "/m", "GoFiles": ["main.go", ]}\n' + pkgJson("/m/lib", { GoFiles: ["lib.go"] });
  assert.strictEqual(o.fileCovered(stream, "/m", "/m/lib/lib.go"), true, "clean object survives the garbled one");
  assert.strictEqual(o.fileCovered(stream, "/m", "/m/main.go"), false, "garbled object claims nothing");
});

const coverageCases = [
  ["GoFiles", true, "a built file is covered"],
  ["IgnoredGoFiles", false, "a build-tag-excluded file is named but not covered"],
  ["TestGoFiles", false, "an in-package test file is named but not covered"],
  ["XTestGoFiles", false, "an external test file is named but not covered"],
];
for (const [field, want, why] of coverageCases) {
  test(`fileCovered: ${field} -> ${want} [${why}]`, () => {
    const o = new GoOracle();
    const stream = pkgJson("/m", { [field]: ["f.go"] });
    assert.strictEqual(o.fileCovered(stream, "/m", "/m/f.go"), want);
  });
}

test("fileCovered: a file in no package's lists is not covered [mechanism: absence is darkness, not a default green]", () => {
  const o = new GoOracle();
  assert.strictEqual(o.fileCovered(pkgJson("/m", { GoFiles: ["a.go"] }), "/m", "/m/stray.go"), false);
});

// ---------------------------------------------------------------------------
// parseCheckOutput edges

test("parse: `go: downloading ...` progress lines are never diagnostics; other go: lines are span-less failures [mechanism: GO_INFO_LINE filter]", () => {
  const o = new GoOracle();
  const text = [
    "go: downloading github.com/google/uuid v1.6.0",
    "go: finding module for package example.com/x",
    "go: inconsistent vendoring in /m:",
  ].join("\n");
  const diags = o.parseCheckOutput(text);
  assert.strictEqual(diags.length, 1, "only the verdict line lands");
  assert.match(diags[0].message, /inconsistent vendoring/);
  assert.strictEqual(diags[0].spans.length, 0, "module-level verdicts carry no span");
});

test("parse: a leading continuation line with no prior diagnostic is dropped, not attached to nothing [mechanism: fold guard]", () => {
  const o = new GoOracle();
  const diags = o.parseCheckOutput("\tgo get example.com/x\nmain.go:3:2: undefined: Wombat");
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].message, "undefined: Wombat", "the orphan tab line vanished");
});

test("parse: continuation folds into message AND rendered keeps the raw multi-line text [mechanism: display surface fidelity]", () => {
  const o = new GoOracle();
  const diags = o.parseCheckOutput(
    "main.go:5:2: no required module provides package example.com/x; to add it:\n\tgo get example.com/x",
  );
  assert.strictEqual(diags.length, 1);
  assert.match(diags[0].message, /to add it: go get example\.com\/x$/, "remediation folded into one message");
  assert.match(diags[0].rendered, /\n\tgo get example\.com\/x$/, "rendered keeps go's own layout");
});

test("parse: the column-less `path.go:line: message` form still lands with columnStart 1 [mechanism: optional col group]", () => {
  const o = new GoOracle();
  const diags = o.parseCheckOutput("weird.go:12: some module-shaped complaint");
  assert.strictEqual(diags.length, 1);
  assert.strictEqual(diags[0].spans[0].lineStart, 12);
  assert.strictEqual(diags[0].spans[0].columnStart, 1);
});

test("parse: a Windows-free sanity - dotted dirs and .go mid-path never half-match [mechanism: path must END .go]", () => {
  const o = new GoOracle();
  const diags = o.parseCheckOutput("pkg.go.dev/something: 12:1: prose that is not a diagnostic");
  assert.strictEqual(diags.length, 0);
});

test("parse: `go: updates to go.mod needed` is a VERDICT diagnostic, never filtered as progress [P1 review F4]", () => {
  const o = new GoOracle();
  const diags = o.parseCheckOutput("go: updates to go.mod needed; to update it:\n\tgo mod tidy");
  assert.strictEqual(diags.length, 1);
  assert.match(diags[0].message, /updates to go\.mod needed.*go mod tidy/);
});

// ---------------------------------------------------------------------------
// the line/col-to-byte conversion (P1 review F1: repair scoping speaks bytes)

function byteOracle(files, mtimes) {
  return new GoOracle({
    readFile: (p) => files[p],
    statMtimeMs: (p) => (mtimes ? mtimes[p] : 0),
    fileExists: () => true,
  });
}

test("bytes: go's column is a BYTE count - a multibyte char before the token shifts nothing [verified against go 1.26.5]", () => {
  // line 2 is `\t_ = "héllo"; x` : é is 2 bytes, go reports the byte column.
  const content = 'package main\n\t_ = "héllo"; x\n';
  const o = byteOracle({ "/m/main.go": content });
  const d = o.parseCheckOutput("./main.go:2:16: undefined: x", "/m")[0];
  const expected = Buffer.byteLength("package main\n", "utf8") + 15;
  assert.strictEqual(d.spans[0].byteStart, expected);
  assert.strictEqual(d.spans[0].byteEnd, expected);
});

test("bytes: no crateRoot (frozen-oracle single-arg call) keeps the -1 sentinel", () => {
  const o = byteOracle({ "/m/main.go": "package main\nx\n" });
  const d = o.parseCheckOutput("./main.go:2:1: undefined: x")[0];
  assert.strictEqual(d.spans[0].byteStart, -1);
});

const byteRefusals = [
  ["unreadable file", {}, undefined, "./gone.go:1:1: msg"],
  ["line past EOF", { "/m/a.go": "one\n" }, undefined, "./a.go:9:1: msg"],
  ["col past line end", { "/m/a.go": "ab\ncd\n" }, undefined, "./a.go:2:9: msg"],
];
for (const [why, files, _x, line] of byteRefusals) {
  test(`bytes: ${why} refuses with -1, never a sliced-onward guess`, () => {
    const d = byteOracle(files).parseCheckOutput(line, "/m")[0];
    assert.strictEqual(d.spans[0].byteStart, -1);
    assert.ok(d.spans[0].lineStart > 0, "line/col survive for display");
  });
}

test("bytes: the autosave guard - a file changed after the check spawned gets the sentinel, unchanged converts", () => {
  const files = { "/m/a.go": "package a\nx\n" };
  const changed = byteOracle(files, { "/m/a.go": 2000 });
  const d1 = changed.parseCheckOutput("./a.go:2:1: msg", "/m", 1000)[0];
  assert.strictEqual(d1.spans[0].byteStart, -1, "mtime past checkStart -> sentinel");
  const clean = byteOracle(files, { "/m/a.go": 500 });
  const d2 = clean.parseCheckOutput("./a.go:2:1: msg", "/m", 1000)[0];
  assert.strictEqual(d2.spans[0].byteStart, Buffer.byteLength("package a\n", "utf8"));
});

test("coverage: a symlinked crateRoot still matches go list's PHYSICAL Dir [P1 review F5]", () => {
  const o = new GoOracle({
    realpath: (p) => p.replace("/link/", "/real/"),
  });
  const stream = pkgJson("/real/m", { GoFiles: ["main.go"] });
  assert.strictEqual(o.fileCovered(stream, "/link/m", "/link/m/main.go"), true);
});

test("coverage: a symlinked .go FILE stays covered - only the DIRNAME canonicalizes, go lists the link's own basename [P2 review F15]", () => {
  // realpath resolves the file link to elsewhere; dirname-only must not follow it.
  const o = new GoOracle({
    realpath: (p) => (p === "/m/linked.go" ? "/elsewhere/original.go" : p),
  });
  const stream = pkgJson("/m", { GoFiles: ["linked.go"] });
  assert.strictEqual(o.fileCovered(stream, "/m", "/m/linked.go"), true, "symlinked file covered");
  const ignored = pkgJson("/m", { IgnoredGoFiles: ["linked.go"] });
  assert.strictEqual(o.fileCovered(ignored, "/m", "/m/linked.go"), false, "ignored symlinked file stays dark");
});

test("bytes: the autosave guard floors sub-ms mtimes - a same-tick save must not false-fire [P2 review F16, tsOracle parity]", () => {
  const files = { "/m/a.go": "package a\nx\n" };
  const o = byteOracle(files, { "/m/a.go": 1000.7 });
  const d = o.parseCheckOutput("./a.go:2:1: msg", "/m", 1000)[0];
  assert.strictEqual(d.spans[0].byteStart, Buffer.byteLength("package a\n", "utf8"), "floor(1000.7)=1000 is NOT past 1000");
});

test("env divergence: a user go env file naming GOFLAGS logs ONE session line; a clean file logs nothing [P2 review F14 partial]", () => {
  const lines = [];
  const envFile = require("path").join(process.env.XDG_CONFIG_HOME ?? require("path").join(require("os").homedir(), ".config"), "go", "env");
  const o = new GoOracle({
    readFile: (p) => (p === envFile ? "GOFLAGS=-tags=demo\nGOPROXY=https://proxy\n" : undefined),
    log: (l) => lines.push(l),
  });
  o.buildCheckCommand("/m");
  o.buildCheckCommand("/m");
  const hits = lines.filter((l) => /GOFLAGS/.test(l) && /GOENV=off/.test(l));
  assert.strictEqual(hits.length, 1, "said once, never silent, never spammed");
  const clean = [];
  const o2 = new GoOracle({ readFile: (p) => (p === envFile ? "GOPROXY=https://proxy\n" : undefined), log: (l) => clean.push(l) });
  o2.buildCheckCommand("/m");
  assert.strictEqual(clean.filter((l) => /GOENV=off/.test(l)).length, 0, "GOPROXY alone diverges nothing the pin does not already own");
});

// ---------------------------------------------------------------------------
// resolveDiagnosticPath fallback

test("resolveDiagnosticPath: crateRoot join wins when it exists; falls back as-printed only when the join does not [mechanism: exists-check fallback]", () => {
  const o = new GoOracle();
  const root = "/m";
  const joined = path.resolve("/m", "./lib/f.go");
  const printed = path.resolve("./lib/f.go");
  const existsOnly = (p) => (want) => p === want;
  assert.strictEqual(o.resolveDiagnosticPath(root, "./lib/f.go", existsOnly(joined)), joined, "join exists -> join");
  assert.strictEqual(o.resolveDiagnosticPath(root, "./lib/f.go", existsOnly(printed)), printed, "join missing, as-printed exists -> as-printed");
  assert.strictEqual(o.resolveDiagnosticPath(root, "./lib/f.go", () => false), joined, "neither exists -> the join is still the path's meaning");
});

// ---------------------------------------------------------------------------
// the diagnosticsOnStderr spawn seam (real spawns of node, no go needed)

const runBundle = bundleCore(
  "impl-v23-gooracle-run",
  `export { runOracleCheck } from "../src/core/compilerOracle";\n`,
);
test.after(() => runBundle.cleanup());
const { runOracleCheck } = runBundle.mod;

function fakeGoOracle(cmdOverrides) {
  // A minimal strategy whose check command is a real node one-liner, so the
  // REAL spawnRunCommand (not a fake) exercises the cap-vs-whole branch.
  return {
    language: "go",
    checkLabel: "go build",
    appliesTo: () => true,
    detectCrateRoot: () => "/tmp",
    buildCheckCommand: () => ({
      command: process.execPath,
      args: ["-e", "const s='e'.repeat(800); process.stderr.write('x.go:1:1: '+s); process.exit(1)"],
      cwd: process.cwd(),
      ...cmdOverrides,
    }),
    parseCheckOutput: (text) => {
      const m = /^x\.go:1:1: (e+)$/.exec(text.trim());
      return m ? [{ kind: "compile-error", level: "error", message: m[1], spans: [], suggestions: [] }] : [];
    },
    checkSuccess: (_t, exit) => exit === 0,
    resolveDiagnosticPath: (r, f) => f,
    isAssertionShaped: () => false,
  };
}

test("spawn seam: diagnosticsOnStderr lifts the 500-char stderr cap so the whole output of record reaches the parser", async () => {
  const res = await runOracleCheck(fakeGoOracle({ diagnosticsOnStderr: true }), "/tmp/x.go");
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.diagnostics.length, 1, "the 810-char stderr line parsed whole");
  assert.strictEqual(res.diagnostics[0].message.length, 800, "nothing truncated");
});

test("spawn seam: an unflagged command keeps the bounded stderr head - the evidence cap is not silently retired for the other oracles", async () => {
  const res = await runOracleCheck(fakeGoOracle({}), "/tmp/x.go");
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.diagnostics.length, 0, "capped stderr never reaches the parser unflagged");
});
