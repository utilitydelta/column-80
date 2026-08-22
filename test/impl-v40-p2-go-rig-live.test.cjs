// LIVE check — session-v40 item 3, phase 2: lib-go.cjs's buildTests really
// drives `go build -o /dev/null ./...` (via the product's own GoOracle),
// against a REAL repo, both directions: green on the clean tree, and red
// with real compiler output once a syntax error is spliced in. This is the
// one part of the Go rig the v40 goal asks to prove live rather than
// with a fixture, because the whole point of the rig is that the checker is
// the product's own oracle running the real toolchain, not a re-derived one.
//
// Skips (never fails) when SKIP_LIVE is set or the corpus/toolchain isn't
// present, same discipline as test/blind-v23-gooracle-live.test.cjs.
//
// Run: node --test test/impl-v40-p2-go-rig-live.test.cjs

// THE MEASUREMENT RIG LIVES IN A DIFFERENT REPOSITORY (2026-08-10). It and the
// session archives were split into a private repo because they carry corpora
// taken against private client code and cannot be published, so a public clone
// has no `session-complxity-research/` and the rows below have no subject.
//
// The whole file skips, with the reason on the channel. It SKIPS rather than
// passing vacuously: a row that goes green when the thing it tests is absent is
// the false green this suite exists to prevent. Where a baseline can be
// vendored instead, vendor it (see test/fixtures/prompt) and do not use this.
const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const goPresent =
  fs.existsSync(path.join(GO_BIN_DIR, "go")) || spawnSync("go", ["version"], { encoding: "utf8" }).status === 0;
const ROOT = process.env.STUDY_ROOT_GO ?? path.join(require("os").homedir(), "sandbox", "v23-corpus");
const cobraPresent = fs.existsSync(path.join(ROOT, "cobra", "go.mod"));

const SKIP =
  process.env.SKIP_LIVE ? "SKIP_LIVE set"
  : !goPresent ? "no go toolchain on PATH or at " + GO_BIN_DIR
  : !cobraPresent ? `no cobra checkout at ${path.join(ROOT, "cobra")}`
  : false;

if (SKIP) {
  test(`lib-go buildTests live checks (SKIPPED: ${SKIP})`, () => {});
} else {
  const lib = require("../session-complxity-research/spikes/lib-go.cjs");
  const { scanFunctions } = require("../session-complxity-research/spikes/lib-go-scan.cjs");

  test("lib-go buildTests: a clean cobra checkout builds green (code === 0)", () => {
    const r = lib.buildTests("cobra", { timeoutMs: 120_000 });
    assert.equal(r.code, 0, `expected a clean build, got stderr:\n${r.stderr.slice(0, 2000)}`);
    assert.equal(typeof r.ms, "number");
    assert.ok(r.ms >= 0);
  });

  test("lib-go buildTests: a deliberately broken function turns the build red, with real go build output, and restore heals it", () => {
    // Pick a real, harmless function to break: any candidate row from
    // args.go with no receiver keeps the splice simple.
    const src = lib.readPristine("cobra/args.go");
    const fn = scanFunctions(src).find((f) => f.name === "NoArgs" && f.implHeader === undefined);
    assert.ok(fn, "NoArgs should exist in cobra/args.go — corpus assumption changed?");
    const cand = { file: "cobra/args.go", name: fn.name, implHeader: fn.implHeader, ...fn };

    let after;
    try {
      // A deliberate syntax error: an unmatched brace. Real go build output,
      // not a fixture — the point of this test.
      lib.spliceFunction(cand, "func NoArgs(cmd *Command, args []string) error {\n\treturn nil\n// missing close brace");
      after = lib.buildTests("cobra", { timeoutMs: 120_000 });
    } finally {
      lib.restore(cand);
    }

    assert.notEqual(after.code, 0, "a syntax error must not build green");
    assert.ok(after.stderr.length > 0, "go build's diagnostics arrive on stderr");
    assert.match(after.stderr, /args\.go/, "the error names the broken file");

    // restore() actually healed the tree: the NEXT build is green again.
    const healed = lib.buildTests("cobra", { timeoutMs: 120_000 });
    assert.equal(healed.code, 0, `restore should have healed the tree, got stderr:\n${healed.stderr.slice(0, 2000)}`);
  });
}
