// LIVE exit gate - session-v51 phase 1. lib-py.cjs's buildTests really drives
// the product's own PyOracle command against the REAL pinned corpus, BOTH
// directions: GREEN when a row's own committed body is spliced back, and RED
// with real pyright diagnostics once a deliberate undefined symbol is spliced
// into the same span.
//
// Both directions is the whole point. A checker that cannot fail is not a gate,
// and for pyright a one-directional check is worse than usual: `filesAnalyzed:
// 0` with `errorCount: 0` is an EXIT-0 pass that analysed nothing, which is
// exactly what an excluded or unreadable target produces. The `filesAnalyzed`
// assertion below is what separates a real green from that one.
//
// The no-op ROUND TRIP is asserted on BYTES, not on the verdict. Python is
// whitespace-sensitive, so a mis-placed body is usually loud - but "usually" is
// not a gate, and a body spliced one level too deep inside a `try:` is valid
// Python that means something else. Both splice paths are checked, because the
// product's Python fn-gen uses the body one (Fork A) and the whole-function one
// only ever runs for a docstring-less target.
//
// Skips (never fails) when SKIP_LIVE is set or the corpus is absent, the same
// discipline as test/impl-v45-cs-rig-live.test.cjs.
//
// Run: node --test test/impl-v51-p1-pyrig-live.test.cjs

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

const MANIFEST = path.join(__dirname, "..", "session-v51", "manifest-py.json");
const ROOT = process.env.STUDY_ROOT_PY ?? path.join(os.homedir(), "sandbox", "v51-corpus-py");

const manifestPresent = fs.existsSync(MANIFEST);
const corpusPresent = fs.existsSync(path.join(ROOT, "mcp-graph-engine")) && fs.existsSync(path.join(ROOT, "debate-event-store"));

const SKIP =
  process.env.SKIP_LIVE ? "SKIP_LIVE set"
  : !manifestPresent ? "no session-v51/manifest-py.json (run build-py-corpus.cjs first)"
  : !corpusPresent ? `no Python corpus at ${ROOT}`
  : false;

if (SKIP) {
  test(`lib-py buildTests live exit gate (SKIPPED: ${SKIP})`, () => {});
} else {
  process.env.STUDY_ROOT_PY = ROOT;
  const lib = require("../session-complxity-research/spikes/lib-py.cjs");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // One row per repo, chosen mechanically: the longest body in that repo whose
  // FILE is pristine-green. The green-file restriction is what makes this the
  // FILE verdict's exit gate - `checkSuccess` cannot go green on a row whose
  // file was already red, and asserting it there would be asserting the wrong
  // rule. The red-file case is the span verdict's, and it has its own row below.
  const perRepo = new Map();
  for (const row of manifest.rows) {
    if (!row.filePristineGreen) continue;
    const best = perRepo.get(row.crate);
    if (!best || row.bodyLines > best.bodyLines) perRepo.set(row.crate, row);
  }
  const subjects = [...perRepo.values()];
  assert.ok(subjects.length >= 2, "the manifest should cover both private repos");

  const abs = (row) => path.join(ROOT, row.file);

  for (const row of subjects) {
    test(`lib-py live: ${row.crate} ${row.name} - own body GREEN, garbage RED`, { timeout: 300_000 }, () => {
      const before = fs.readFileSync(abs(row), "utf8");
      try {
        // --- the whole-function no-op round trip, on bytes ---
        lib.spliceFunction(row, lib.committedFunctionText(row));
        assert.equal(
          fs.readFileSync(abs(row), "utf8"),
          before,
          "splicing the function's own bytes back must reproduce the file exactly",
        );
        lib.restore(row);

        // --- the Fork A body round trip, on bytes, then GREEN ---
        lib.spliceBody(row, lib.committedBodyBelowDoc(row));
        assert.equal(
          fs.readFileSync(abs(row), "utf8"),
          before,
          "splicing the body below the docstring back must reproduce the file exactly",
        );
        const green = lib.buildTests(row.file);
        assert.equal(green.ok, true, `expected a green check, got ${green.errors.length} error(s): ${green.errors[0] ?? ""}`);
        assert.equal(green.code, 0);
        assert.equal(green.exitCode, 0, "pyright exits 0 on a clean file");
        // THE UNEARNED-GREEN GUARD. errorCount 0 with filesAnalyzed 0 is a
        // check that never ran, and it is the failure the exit code cannot see.
        assert.ok(green.filesAnalyzed > 0, "a green with filesAnalyzed 0 is a check that analysed nothing");
        lib.restore(row);

        // --- the other direction ---
        lib.spliceBody(row, "return __rig_undefined_symbol_v51__(no_such_name_either)");
        const red = lib.buildTests(row.file);
        assert.equal(red.ok, false, "a body referring to an undefined symbol must not grade green");
        assert.equal(red.code, 1);
        assert.ok(red.errors.length > 0, "a red verdict must come with real pyright diagnostics");
        assert.ok(
          red.errors.some((e) => e.includes("__rig_undefined_symbol_v51__")),
          `the diagnostics must name the spliced symbol, got: ${red.errors[0] ?? "(none)"}`,
        );
      } finally {
        lib.restore(row);
      }
      assert.equal(fs.readFileSync(abs(row), "utf8"), before, "the corpus must be pristine when the row ends");
    });
  }

  test("lib-py live: the whole population's splice offsets still land", { timeout: 300_000 }, () => {
    // Not a sample. `assertOffsets` throws on a stale span, and a rig that only
    // ever checks the rows it happens to run has a corpus that shrinks behind
    // the measurement's back.
    for (const row of manifest.rows) {
      const text = lib.readPristine(row.file);
      lib.assertOffsets(row, text);
      assert.equal(text[row.docEnd], "\n", `${row.id}: docEnd is not followed by a newline`);
      // Both placement rules, byte-exact, on every row.
      assert.equal(
        text.slice(0, row.declStart) + lib.placeAtColumn(row.indent + text.slice(row.declStart, row.bodyClose + 1), row.indent) + text.slice(row.bodyClose + 1),
        text,
        `${row.id}: the whole-function placement is not a no-op on its own bytes`,
      );
      assert.equal(
        text.slice(0, row.docEnd) + "\n" + lib.placeBodyAtColumn(text.slice(row.docEnd + 1, row.bodyClose + 1), row.bodyIndent) + text.slice(row.bodyClose + 1),
        text,
        `${row.id}: the body placement is not a no-op on its own bytes`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // The span-scoped verdict, on a row in a file that is NOT pristine-green.
  // This is the case the whole rule exists for and the one the file verdict
  // cannot grade: 82 of the 379 population rows live in such a file.
  // -------------------------------------------------------------------------

  const inRedFile = manifest.rows
    .filter((r) => r.filePristineGreen === false)
    .sort((a, b) => b.baselineOutOfSpan - a.baselineOutOfSpan || b.bodyLines - a.bodyLines)[0];

  test("lib-py live: a row in a RED file grades clean-out-of-span on its own body and in-span on garbage", { timeout: 300_000 }, () => {
    assert.ok(inRedFile, "the population must contain a row unlocked by the span rule, or the rule bought nothing");
    const target = path.join(ROOT, inRedFile.file);
    const before = fs.readFileSync(target, "utf8");
    try {
      const own = lib.spliceBody(inRedFile, lib.committedBodyBelowDoc(inRedFile));
      assert.equal(fs.readFileSync(target, "utf8"), before, "the control must be a byte no-op");
      const clean = lib.buildTests(inRedFile.file);
      const cleanSpan = lib.gradeSpan(inRedFile, clean, own.text, own.spanStart, own.spanEnd);

      // The two verdicts DISAGREE, and that is the finding, not a defect.
      assert.equal(clean.ok, false, "the file is not pristine-green - that is why this row is here");
      assert.equal(cleanSpan.kind, "clean-out-of-span");
      assert.equal(cleanSpan.ok, true, "the row's own span carries no pre-existing error");
      assert.equal(cleanSpan.inSpanCount, 0);
      // The pre-existing errors are CARRIED, not dropped. A verdict that
      // silently discarded them would be indistinguishable from a green file.
      assert.ok(cleanSpan.outOfSpanCount > 0, "the file's pre-existing errors must appear as out-of-span");
      assert.equal(
        cleanSpan.outOfSpanCount,
        clean.diagnostics.filter((d) => d.level === "error").length,
        "every error the file check found is accounted for",
      );
      // The COUNT is the truth and the rendered list is a sample. Deriving the
      // count from the list is `recording-cap-is-a-measurement-cap`.
      assert.ok(cleanSpan.outOfSpan.length <= 40);
      assert.ok(cleanSpan.outOfSpanFiles.includes(target));
      lib.restore(inRedFile);

      // The other direction. A verdict that cannot go red is not a verdict.
      const bad = lib.spliceBody(inRedFile, "return __rig_undefined_symbol_v51__(no_such_name_either)");
      const red = lib.buildTests(inRedFile.file);
      const redSpan = lib.gradeSpan(inRedFile, red, bad.text, bad.spanStart, bad.spanEnd);
      assert.equal(redSpan.kind, "in-span");
      assert.equal(redSpan.ok, false);
      assert.ok(
        redSpan.inSpan.some((e) => e.includes("__rig_undefined_symbol_v51__")),
        `the in-span errors must name the spliced symbol, got: ${redSpan.inSpan[0] ?? "(none)"}`,
      );
      // The pre-existing set is unchanged by the garbage, so the two verdicts
      // are separable: the row went red on its own errors, not on the file's.
      assert.equal(redSpan.outOfSpanCount, cleanSpan.outOfSpanCount);
    } finally {
      lib.restore(inRedFile);
    }
    assert.equal(fs.readFileSync(target, "utf8"), before, "the corpus must be pristine when the row ends");
  });

  test("lib-py live: the scope is the WHOLE function, because a return-type fault is reported at the `def` line", { timeout: 300_000 }, () => {
    // The measurement that decided the scope. A body of `pass` in a function
    // declared `-> dict` is reported by pyright AT THE DECLARATION, above the
    // generated region. Under a body-only scope that error reads as somebody
    // else's and the row grades GREEN - a false green on a body that does not
    // return. Both scopes are graded here off ONE check, so the difference is
    // the geometry and nothing else.
    const row = manifest.rows.find((r) => /->\s*(dict|str|list|bool|int)\b/.test(r.signature) && r.filePristineGreen);
    assert.ok(row, "the population must contain a green-file row with a non-None declared return type");
    const target = path.join(ROOT, row.file);
    const before = fs.readFileSync(target, "utf8");
    try {
      const p = lib.spliceBody(row, "pass");
      const check = lib.buildTests(row.file);
      const whole = lib.gradeSpan(row, check, p.text, p.spanStart, p.spanEnd);
      const bodyOnly = lib.gradeSpan(row, check, p.text, row.docEnd + 1, p.spanEnd);
      assert.equal(whole.kind, "in-span", "the whole-function scope must own the return-type fault");
      assert.ok(whole.inSpan.some((e) => /reportReturnType/.test(e)), whole.inSpan[0] ?? "(none)");
      assert.equal(bodyOnly.kind, "clean-out-of-span", "the body-only scope would have called this clean - the false green");
    } finally {
      lib.restore(row);
    }
    assert.equal(fs.readFileSync(target, "utf8"), before);
  });

  test("lib-py live: every population row's own span is pristine, and the unlock count is real", { timeout: 600_000 }, () => {
    // The population's defining invariant, re-derived rather than trusted. A
    // row whose pristine span already carries an error cannot be graded by any
    // rule, and one that slipped in would read as a model failure.
    const checks = new Map();
    let unlocked = 0;
    let unlockedSrc = 0;
    for (const row of manifest.rows) {
      if (!checks.has(row.file)) checks.set(row.file, lib.buildTests(row.file));
      const check = checks.get(row.file);
      const v = lib.pristineSpanVerdict(row, check);
      assert.notEqual(v.kind, "in-span", `${row.id}: a pre-existing error lands inside this row's own span`);
      assert.equal(v.outOfSpanCount, row.baselineOutOfSpan, `${row.id}: the manifest's baselineOutOfSpan is stale`);
      assert.equal(check.ok, row.filePristineGreen, `${row.id}: the manifest's filePristineGreen is stale`);
      if (!check.ok) {
        unlocked++;
        if (row.file.split(path.sep).includes("src")) unlockedSrc++;
      }
    }
    assert.equal(unlocked, manifest.counts.rowsUnlockedBySpanRule);
    assert.equal(unlockedSrc, manifest.counts.rowsUnlockedInSrc);
    assert.ok(unlocked > 0, "if the span rule unlocks nothing it is not earning its complexity");
  });

  test("lib-py live: the checker is the PRODUCT'S, and its scope is per-file", { timeout: 300_000 }, () => {
    assert.equal(lib.pyOracle.checkLabel, "pyright");
    const row = subjects[0];
    const cmd = lib.pyOracle.buildCheckCommand(path.join(ROOT, row.crate), undefined, abs(row));
    assert.ok(cmd.args.includes("--outputjson"), "the rig grades off the JSON, not the human output");
    assert.ok(cmd.args.includes("--pythonpath"), "the project's own interpreter must be passed, or every import is unresolved");
    assert.equal(cmd.args[cmd.args.length - 1], abs(row), "the target is the touched FILE, not the root");
    // The sibling-contamination fact the per-file scope exists for: this repo
    // has pre-existing errors in files no row touches.
    const wholeRoot = lib.buildTests(row.crate);
    assert.equal(wholeRoot.ok, false, "the corpus is not clean whole-root, which is why the scope is per-file");
    assert.ok(wholeRoot.filesAnalyzed > 1, "a whole-root check analyses more than one file");
  });
}
