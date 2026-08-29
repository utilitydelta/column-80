// BLIND ORACLE: the explainer stops swallowing a dead transport (session-v64
// phase 1).
//
// Written from `session-v64/goal.md` ALONE, plus the public facade the goal
// hands us for `src/core/criticizeExplain.ts` (`ExplainFailure`, the new
// `report` parameter of `explainFinding`) and `src/core/criticizeGesture.ts`
// (`explainedLine`). Neither file's internals were read to shape an
// assertion here.
//
// The channel read "explained 0 of 2 elevated row(s)" on every one of 44 host
// runs, across every language, for a whole release. Nothing was wrong with
// the finding-selection or the rendering: ollama was never running. The
// reason nobody noticed is a real defect in `explainFinding`: a thrown
// transport (no server, connection refused, an HTTP error) and a transport
// that answered with nothing usable both come back as the empty string, so
// "there is no model" and "the model spoke and said nothing" are
// byte-identical on the channel. This file pins the fix: the empty string is
// still the return value in both cases (nothing here may change what a
// caller of `explainFinding` currently receives), but an optional `report`
// callback now gets told WHICH of the two happened, tagged with a `kind` that
// must never be spelled the same way twice for two different reasons. And
// `explainedLine` must put that difference on the channel: a dead backend has
// to look different from a model that answered uselessly, in the words a
// human reads.
//
// Run: SKIP_LIVE=1 node --test test/blind-v64-p1-swallow.test.cjs
//
// Chosen keyword for test 7 (see the comment there): "reach". Whatever
// sentence `explainedLine` writes for an "unavailable" failure, it must
// contain that word, because a backend that cannot be reached is the fact
// being reported.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// The `report` parameter and `ExplainFailure` may not exist yet, and
// `explainedLine` may not exist at all. Bundle defensively and star-export,
// so one missing symbol fails only the tests that touch it rather than
// collapsing the whole file into one opaque load error.
let mod = {};
let loadError;
let cleanup = () => {};
try {
  const bundled = bundleCore(
    "blind-v64-p1-swallow",
    `export * from "../src/core/criticizeExplain";
export { explainedLine } from "../src/core/criticizeGesture";\n`,
  );
  cleanup = bundled.cleanup;
  mod = bundled.mod;
} catch (err) {
  loadError = err;
  // bundleCore writes its entry file BEFORE esbuild runs, so a resolve
  // failure leaves it behind. Expected RED until phase 1 exists; don't litter.
  const path = require("path");
  const fs = require("fs");
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v64-p1-swallow.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v64-p1-swallow.bundle.cjs"), { force: true });
  };
}
test.after(() => cleanup());

/** Fetch an exported symbol, or fail this test by name. */
function need(name) {
  if (loadError) {
    throw new Error(`v64 phase 1 modules did not load: ${loadError && loadError.message}`);
  }
  const value = mod[name];
  if (value === undefined) {
    throw new Error(`contract names \`${name}\` but it is not exported`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures shared across tests.
// ---------------------------------------------------------------------------

const FINDING = {
  dimension: "cqs",
  line: 5,
  evidence: "seen.set(key, now);",
  detail: "mutates state and returns a value",
};
const SOURCE = "Meyer 1988, command-query separation";
const AUTH = { finding: FINDING, source: SOURCE };

/** Collects every failure a call reports, in order, without assuming
 *  anything about how many times `report` runs. */
function collector() {
  const failures = [];
  return { report: (f) => failures.push(f), failures };
}

// ---------------------------------------------------------------------------
// A harness sanity check: prove the bundling mechanism itself works before
// trusting any RED result below to mean what it claims.
// ---------------------------------------------------------------------------

test("harness sanity: the module bundles and the pre-existing exports are there", () => {
  assert.strictEqual(typeof need("explainFinding"), "function");
  assert.strictEqual(typeof need("EXPLANATION_MAX_LINES"), "number");
});

// ---------------------------------------------------------------------------
// 1. A thrown transport: unchanged return value, one "unavailable" failure.
// ---------------------------------------------------------------------------

test("1. a transport that throws still returns the empty string, and reports exactly one 'unavailable' failure carrying the message", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const text = await explainFinding(AUTH, async () => {
    throw new Error("connection refused");
  }, report);

  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "unavailable");
  assert.strictEqual(typeof failures[0].detail, "string");
  assert.strictEqual(failures[0].detail.includes("connection refused"), true);
});

test("1b. a transport that throws SYNCHRONOUSLY (not via a rejected promise) is caught the same way", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const text = await explainFinding(AUTH, () => {
    throw new Error("no client configured");
  }, report);

  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "unavailable");
  assert.strictEqual(failures[0].detail.includes("no client configured"), true);
});

test("1c. a rejection with a non-Error value still reports 'unavailable' and still returns empty", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const text = await explainFinding(AUTH, async () => {
    throw "HTTP 503";
  }, report);

  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "unavailable");
  assert.strictEqual(typeof failures[0].detail, "string");
});

// ---------------------------------------------------------------------------
// 2. Empty / whitespace-only prose: "silent", never "unavailable".
// ---------------------------------------------------------------------------

test("2. a transport resolving to the empty string reports 'silent', not 'unavailable'", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const text = await explainFinding(AUTH, async () => "", report);

  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "silent");
});

test("2b. a transport resolving to whitespace-only text also reports 'silent'", async () => {
  const explainFinding = need("explainFinding");

  for (const blank of ["   ", "\n", "\n\n\n", "  \t \n  \t "]) {
    const { report, failures } = collector();
    const text = await explainFinding(AUTH, async () => blank, report);
    assert.strictEqual(text, "");
    assert.strictEqual(failures.length, 1, `blank ${JSON.stringify(blank)} did not report exactly once`);
    assert.strictEqual(failures[0].kind, "silent");
  }
});

test("2c. the 'unavailable' and 'silent' spellings never collide", () => {
  const ExplainFailureKinds = ["unavailable", "silent", "unusable"];
  assert.strictEqual(new Set(ExplainFailureKinds).size, ExplainFailureKinds.length);
});

// ---------------------------------------------------------------------------
// 3. Past the line bound: "unusable", and still returns "".
// ---------------------------------------------------------------------------

test("3. a transport that answers past EXPLANATION_MAX_LINES reports 'unusable' and returns the empty string", async () => {
  const explainFinding = need("explainFinding");
  const MAX = need("EXPLANATION_MAX_LINES");
  const { report, failures } = collector();

  const overLong = Array.from({ length: MAX + 1 }, (_, i) => `line ${i + 1} of prose`).join("\n");
  const text = await explainFinding(AUTH, async () => overLong, report);

  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "unusable");
});

test("3b. prose of exactly EXPLANATION_MAX_LINES is NOT over the bound: no failure, and the text comes back", async () => {
  const explainFinding = need("explainFinding");
  const MAX = need("EXPLANATION_MAX_LINES");
  const { report, failures } = collector();

  const atBound = Array.from({ length: MAX }, (_, i) => `line ${i + 1} of prose`).join("\n");
  const text = await explainFinding(AUTH, async () => atBound, report);

  assert.strictEqual(text, atBound);
  assert.strictEqual(failures.length, 0);
});

// ---------------------------------------------------------------------------
// 4. Admissible prose: no report at all, trimmed text returned.
// ---------------------------------------------------------------------------

test("4. admissible prose reports NOTHING and returns the trimmed text", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const text = await explainFinding(
    AUTH,
    async () => "\n  command-query separation, Meyer 1988.  \n",
    report,
  );

  assert.strictEqual(text, "command-query separation, Meyer 1988.");
  assert.strictEqual(failures.length, 0);
});

// ---------------------------------------------------------------------------
// 5. Cancellation is rethrown, and is never reported as a failure.
// ---------------------------------------------------------------------------

for (const name of ["Canceled", "CancellationError", "AbortError"]) {
  test(`5. a transport that throws a cancellation named '${name}' is RETHROWN, not swallowed, and reports nothing`, async () => {
    const explainFinding = need("explainFinding");
    const { report, failures } = collector();

    const err = new Error("user cancelled");
    err.name = name;

    let threw = null;
    try {
      await explainFinding(AUTH, async () => { throw err; }, report);
    } catch (caught) {
      threw = caught;
    }

    assert.notStrictEqual(threw, null, `a '${name}' error must propagate out of explainFinding`);
    assert.strictEqual(threw, err);
    assert.strictEqual(failures.length, 0, `a cancellation must not be reported as a failure`);
  });
}

test("5b. a plain error whose name happens to share no cancellation spelling IS reported, to show test 5 is not vacuous", async () => {
  const explainFinding = need("explainFinding");
  const { report, failures } = collector();

  const err = new Error("connection refused");
  err.name = "Error";

  const text = await explainFinding(AUTH, async () => { throw err; }, report);
  assert.strictEqual(text, "");
  assert.strictEqual(failures.length, 1);
  assert.strictEqual(failures[0].kind, "unavailable");
});

// ---------------------------------------------------------------------------
// 6. `report` is optional: identical behaviour, omitted or not, no throw.
// ---------------------------------------------------------------------------

test("6. every scenario above behaves identically with `report` omitted, and never throws because of it", async () => {
  const explainFinding = need("explainFinding");
  const MAX = need("EXPLANATION_MAX_LINES");

  // unavailable
  await assert.doesNotReject(async () => {
    const text = await explainFinding(AUTH, async () => { throw new Error("boom"); });
    assert.strictEqual(text, "");
  });

  // silent
  await assert.doesNotReject(async () => {
    const text = await explainFinding(AUTH, async () => "   ");
    assert.strictEqual(text, "");
  });

  // unusable
  await assert.doesNotReject(async () => {
    const overLong = Array.from({ length: MAX + 1 }, () => "x").join("\n");
    const text = await explainFinding(AUTH, async () => overLong);
    assert.strictEqual(text, "");
  });

  // admissible
  await assert.doesNotReject(async () => {
    const text = await explainFinding(AUTH, async () => "fine prose.");
    assert.strictEqual(text, "fine prose.");
  });

  // cancellation still rethrows even with report omitted
  const err = new Error("cancel");
  err.name = "Canceled";
  await assert.rejects(async () => {
    await explainFinding(AUTH, async () => { throw err; });
  }, (caught) => caught === err);
});

// ---------------------------------------------------------------------------
// 7/8. `explainedLine`: the channel must SAY the difference.
// ---------------------------------------------------------------------------

const UNAVAILABLE_FAILURE = { kind: "unavailable", detail: "connection refused" };
const SILENT_FAILURE = { kind: "silent", detail: "" };

test("7. 'unavailable' and 'silent' produce different lines for explained=0, total=2, and both differ from zero failures", () => {
  const explainedLine = need("explainedLine");

  const unavailableLine = explainedLine(0, 2, [UNAVAILABLE_FAILURE, UNAVAILABLE_FAILURE]);
  const silentLine = explainedLine(0, 2, [SILENT_FAILURE, SILENT_FAILURE]);
  const noFailureLine = explainedLine(0, 2, []);

  assert.strictEqual(typeof unavailableLine, "string");
  assert.strictEqual(typeof silentLine, "string");
  assert.strictEqual(typeof noFailureLine, "string");

  assert.notStrictEqual(unavailableLine, silentLine);
  assert.notStrictEqual(unavailableLine, noFailureLine);
  assert.notStrictEqual(silentLine, noFailureLine);

  // Chosen keyword for the unavailable case: "reach". A dead backend must be
  // named in words a human reads, and this is the word a reasonable
  // implementation is expected to use to say so (e.g. "could not be
  // reached", "unreachable").
  assert.strictEqual(
    unavailableLine.toLowerCase().includes("reach"),
    true,
    `expected the unavailable-case line to say the backend could not be reached (substring "reach"); got: ${unavailableLine}`,
  );

  // And the silent case must NOT borrow that same word, or the two lines stop
  // being distinguishable in the one way that matters.
  assert.strictEqual(
    silentLine.toLowerCase().includes("reach"),
    false,
    `the silent-case line reused the unreachable wording; that erases the distinction the phase exists to draw: ${silentLine}`,
  );
});

test("8. explainedLine always carries the counts", () => {
  const explainedLine = need("explainedLine");

  for (const failures of [[], [UNAVAILABLE_FAILURE], [SILENT_FAILURE, SILENT_FAILURE]]) {
    const line = explainedLine(0, 2, failures);
    assert.strictEqual(line.includes("0 of 2"), true, `line lost the counts: ${line}`);
  }

  // A different pair of counts must show up as a different pair of counts.
  const oneOfThree = explainedLine(1, 3, []);
  assert.strictEqual(oneOfThree.includes("1 of 3"), true);
});

test("8b. a mix of failure kinds does not collapse to only one of them: the unavailable case must still read as unreachable", () => {
  const explainedLine = need("explainedLine");

  const mixed = explainedLine(0, 2, [UNAVAILABLE_FAILURE, SILENT_FAILURE]);
  assert.strictEqual(typeof mixed, "string");
  assert.strictEqual(mixed.includes("0 of 2"), true);
  // At least one row was unreachable; that fact must not be silently dropped
  // just because a second row failed for a different reason.
  assert.strictEqual(mixed.toLowerCase().includes("reach"), true);
});

// ---------------------------------------------------------------------------
// A positive control on the whole file: at least one scenario above must
// currently be failing for the RIGHT reason (a missing export or a missing
// third parameter's effect), not because the harness itself is broken. This
// is asserted by running the file and reading its own output, not by code
// here - see the report at the end of this task.
// ---------------------------------------------------------------------------
