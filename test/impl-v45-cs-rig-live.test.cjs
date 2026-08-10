// LIVE exit gate - session-v45 phase 0. lib-cs.cjs's buildTests really drives
// the product's own `dotnet build <csproj> --no-restore` against the REAL
// pinned corpus, BOTH directions, once per repo: green on a no-op splice, and
// RED with real compiler output once a deliberate error is spliced in.
//
// Both directions, per repo, is the whole point. goal.md phase 0: "A checker
// that cannot fail is not a gate." A one-directional check passes just as well
// when the build is silently compiling nothing - which is exactly what a
// wrongly pinned TFM, an unrestored project, or a <Compile Remove> would do,
// and every one of those failure modes reports code === 0 forever.
//
// Skips (never fails) when SKIP_LIVE is set or the toolchain/corpus is absent,
// the same discipline as test/impl-v40-p2-go-rig-live.test.cjs.
//
// Run: node --test test/impl-v45-cs-rig-live.test.cjs

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
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.STUDY_ROOT_CS ?? path.join(os.homedir(), "sandbox", "v43-corpus");
const CANDIDATES = path.join(__dirname, "..", "session-complxity-research", "data", "candidates-cs.json");

const dotnetPresent = spawnSync("dotnet", ["--version"], { encoding: "utf8" }).status === 0;
const corpusPresent = fs.existsSync(path.join(ROOT, "Autofac", "src", "Autofac"));
const candidatesPresent = fs.existsSync(CANDIDATES);

const SKIP =
  process.env.SKIP_LIVE ? "SKIP_LIVE set"
  : !dotnetPresent ? "no dotnet SDK on PATH"
  : !corpusPresent ? `no C# corpus at ${ROOT}`
  : !candidatesPresent ? `no candidates-cs.json (run 01-corpus-cs.cjs first)`
  : false;

if (SKIP) {
  test(`lib-cs buildTests live exit gate (SKIPPED: ${SKIP})`, () => {});
} else {
  const lib = require("../session-complxity-research/spikes/lib-cs.cjs");
  const cands = JSON.parse(fs.readFileSync(CANDIDATES, "utf8"));

  // One row per repo, chosen mechanically: the first candidate whose body is
  // big enough that a no-op splice is a real round trip rather than a nudge.
  const byRepo = new Map();
  for (const c of cands) {
    if (byRepo.has(c.crate)) continue;
    if (c.refBody.split("\n").length < 4) continue;
    byRepo.set(c.crate, c);
  }

  assert.ok(byRepo.size >= 5, `expected a row for each of the 5 pinned repos, got ${byRepo.size}`);

  for (const [repo, cand] of byRepo) {
    test(`${repo}: a NO-OP splice of ${cand.name} rebuilds green`, { timeout: 400_000 }, () => {
      const text = lib.readPristine(cand.file);
      const original = text.slice(cand.declStart, cand.bodyClose + 1);
      try {
        // The candidate's own bytes back into its own span. If the offsets are
        // right this cannot change the file at all, and the build must agree.
        lib.spliceFunction(cand, original);
        const after = fs.readFileSync(path.join(ROOT, cand.file), "utf8");
        assert.equal(after, text, "a no-op splice must reproduce the file byte for byte");

        const build = lib.buildTests(cand.project);
        assert.equal(build.timedOut, false, "build timed out");
        assert.equal(
          build.code,
          0,
          `expected green, got ${build.code}\n${(build.stdout || "").slice(-2000)}`,
        );
        assert.ok(build.tfm, "every graded row must record the TFM it was pinned to");
      } finally {
        lib.restore(cand);
      }
    });

    test(`${repo}: a BROKEN splice of ${cand.name} rebuilds RED with real compiler output`, { timeout: 400_000 }, () => {
      try {
        const broken = `${cand.signature}\n{\n    __column80_deliberate_error__();\n}`;
        lib.spliceFunction(cand, broken);

        const build = lib.buildTests(cand.project);
        assert.equal(build.timedOut, false, "build timed out");
        assert.notEqual(build.code, 0, "a deliberately broken body MUST fail the build");
        const out = `${build.stdout}\n${build.stderr}`;
        // A real diagnostic from the real compiler, naming the real symbol -
        // not merely a nonzero exit, which a missing project would also give.
        assert.match(out, /error CS\d+/, `expected a CS diagnostic, got:\n${out.slice(-2000)}`);
        assert.match(out, /__column80_deliberate_error__/, "the diagnostic must name the spliced symbol");
      } finally {
        lib.restore(cand);
      }
    });
  }

  // The two whole-corpus invariants, asserted over every row rather than the
  // five the build rows sample. Both were BROKEN and neither could be seen by
  // building: the review found 85 rows whose no-op splice shifted the body
  // (green anyway, because C# ignores columns) and 8 rows silently dropped by a
  // refresh against files nobody had touched. Cheap - no spawn, pure bytes -
  // so there is no excuse for sampling.
  test("EVERY candidate's no-op splice is byte-identical", () => {
    let bad = [];
    for (const c of cands) {
      const text = lib.readPristine(c.file);
      const original = text.slice(c.declStart, c.bodyClose + 1);
      const next = text.slice(0, c.declStart) + lib.placeAtColumn(original, c.indent) + text.slice(c.bodyClose + 1);
      if (next !== text) bad.push(c.id);
    }
    assert.deepEqual(bad, [], `${bad.length} of ${cands.length} rows corrupt on a no-op splice`);
  });

  test("a refresh against the untouched corpus drops nothing and moves nothing", () => {
    const r = lib.refreshCandidates(cands);
    assert.equal(r.dropped.length, 0, `dropped: ${JSON.stringify(r.dropped.slice(0, 5))}`);
    assert.equal(r.refreshed, 0, "no offset should move against files nobody edited");
    assert.equal(r.unchanged, cands.length);
  });

  test("every candidate's offsets still land on its own method", () => {
    for (const c of cands) lib.assertOffsets(c, lib.readPristine(c.file));
  });

  test("the corpus restores clean: every touched repo builds green again", { timeout: 900_000 }, () => {
    for (const [repo, cand] of byRepo) {
      const build = lib.buildTests(cand.project);
      assert.equal(build.code, 0, `${repo} did not restore clean:\n${(build.stdout || "").slice(-1500)}`);
    }
  });
}
