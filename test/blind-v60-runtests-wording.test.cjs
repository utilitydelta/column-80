// Blind oracle: renderRunTestsReport, the pure wording of the Run Covering
// Tests gesture (session-v60/contracts/phaseB1-run-tests.md, "The wording
// rules"). Fixture shapes come from phaseA2-transport-and-grouping.md
// (DiscoveryReport / RunGroup / RunnableTest) and from the TestOracleResult
// interface in src/core/compilerOracle.ts.
//
// Blind discipline: this file has NOT read src/core/runTestsReport.ts nor the
// vscode command that calls it. Every assertion is derived from the contract.
// Where the contract QUOTES wording the row binds to the quoted words; where it
// states a requirement in prose the row binds to substance and carries a
// `CONTRACT GAP:` note saying what it bound to. Expected red until the module
// exists.
//
// Run: SKIP_LIVE=1 node --test test/blind-v60-runtests-wording.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// The module under test may not exist yet. A bundle failure must show up as a
// red row per rule, not as one opaque file-level crash that hides the count.
let bundled;
let bundleError;
try {
  bundled = bundleCore(
    "blind-v60-runtests-wording",
    `export { renderRunTestsReport } from "../src/core/runTestsReport";\n`,
  );
} catch (e) {
  bundleError = e;
}
test.after(() => bundled && bundled.cleanup());

const impl = bundled && bundled.mod && bundled.mod.renderRunTestsReport;
const renderRunTestsReport = (input) => {
  if (typeof impl !== "function") {
    throw new Error(
      `renderRunTestsReport is not available: ${bundleError ? String(bundleError.message).split("\n")[0] : "src/core/runTestsReport exports no renderRunTestsReport"}`,
    );
  }
  return impl(input);
};

// ---------------------------------------------------------------- fixtures

const SYMBOL = "settleBalance";
const RUST_SYMBOL = "settle_balance";

const placement = (over = {}) => ({
  targetPath: "/repo/crates/ledger/src/settle.rs",
  exists: true,
  mode: "same-file",
  runRoot: "/repo/crates/ledger",
  ...over,
});

const walk = (over = {}) => ({
  tests: [],
  requests: 41,
  nodesAdmitted: 96,
  depthReached: 3,
  outOfScope: 2,
  failedRequests: 0,
  ...over,
});

const rt = (filter, filePath, distance, path) => ({ filter, filePath, distance, path });

const entry = (name, filePath, distance, path, over = {}) => ({ name, filePath, distance, path, ...over });

const group = (key, tests, over = {}) => ({
  placement: placement({ runRoot: key }),
  frameworkId: "libtest",
  tests,
  key,
  ...over,
});

const okResult = (over = {}) => ({
  ran: true,
  success: true,
  cases: [],
  failures: [],
  passed: 3,
  failed: 0,
  ignored: 0,
  durationMs: 812,
  crateRoot: "/repo/crates/ledger",
  casesComplete: true,
  ...over,
});

const outcome = (over = {}) => ({
  key: "/repo/crates/ledger",
  frameworkName: "cargo test",
  tests: [],
  ...over,
});

const report = (over = {}) => ({
  discovered: [],
  groups: [],
  walk: walk(),
  provenZero: false,
  ...over,
});

const input = (over = {}) => ({
  symbolName: RUST_SYMBOL,
  languageId: "rust",
  scopeWord: "crate",
  discovery: report(),
  outcomes: [],
  ...over,
});

// Three tests at three distances, used by the green row and the distance row.
const NEAR = rt("settles_a_zero_balance", "/repo/crates/ledger/src/settle.rs", 1, [
  "settles_a_zero_balance",
  "settle_balance",
]);
const MID = rt("ledger_totals_match", "/repo/crates/ledger/tests/ledger.rs", 2, [
  "ledger_totals_match",
  "post_ledger",
  "settle_balance",
]);
const FAR = rt("end_to_end_month_close", "/repo/crates/ledger/tests/e2e.rs", 7, [
  "end_to_end_month_close",
  "close_month",
  "run_close",
  "reconcile",
  "post_batch",
  "post_ledger",
  "apply_entry",
  "settle_balance",
]);
const THREE = [NEAR, MID, FAR];
const THREE_ENTRIES = THREE.map((t) => entry(t.filter, t.filePath, t.distance, t.path));

const IGNORED_MARKER = "#[ignore]";
const ENCLOSING_MARKER = '#[cfg(feature = "slow")]';
const UNRUNNABLE_REASON = "the server's name for this test cannot become a runner filter";

// ------------------------------------------------------------- scenarios
// Every fixture in the file lives here so rule 10 can sweep all of them and so
// the determinism / toast / purity rows cover every shape the module can meet.

const SCENARIOS = [];
const scenario = (id, over) => {
  const s = { id, input: input(over) };
  SCENARIOS.push(s);
  return s.input;
};

const S_PROVEN_ZERO = scenario("proven-zero", {
  discovery: report({ provenZero: true, walk: walk({ requests: 113, nodesAdmitted: 307, depthReached: 8 }) }),
});

const boundedZero = (id, walkOver) =>
  scenario(id, { discovery: report({ provenZero: false, walk: walk(walkOver) }) });

const S_BOUNDED = {
  requests: boundedZero("bounded-requests", { stoppedBy: "requests", requests: 150 }),
  nodes: boundedZero("bounded-nodes", { stoppedBy: "nodes", nodesAdmitted: 400 }),
  depth: boundedZero("bounded-depth", { stoppedBy: "depth", depthReached: 8 }),
  cancelled: boundedZero("bounded-cancelled", { stoppedBy: "cancelled" }),
  "hang-guard": boundedZero("bounded-hang-guard", { stoppedBy: "hang-guard" }),
};

// CONTRACT GAP: phaseA2 rule 4 computes provenZero from `stoppedBy === undefined
// && discovered.length === 0` ALONE, so a walk whose only defect is a rejected
// resolveCallers would compute provenZero TRUE. phaseB1 rule 2 lists "a caller
// the server could not resolve" as a cause that must NOT get rule 1's sentence.
// This fixture takes B1's side: provenZero false, failedRequests 3. If the
// facade really does hand B1 provenZero:true here, the defect is in A2 rule 4.
const S_FAILED_REQUESTS = scenario("bounded-failed-requests", {
  discovery: report({ provenZero: false, walk: walk({ failedRequests: 3, requests: 44 }) }),
});

const S_GREEN = scenario("green-run", {
  discovery: report({
    discovered: THREE_ENTRIES,
    groups: [group("/repo/crates/ledger", THREE)],
    walk: walk({ tests: [] }),
  }),
  outcomes: [outcome({ tests: THREE, result: okResult({ passed: 3 }) })],
});

const S_DISTANCES = scenario("distances", {
  discovery: report({
    discovered: THREE_ENTRIES,
    groups: [group("/repo/crates/ledger", THREE)],
  }),
  outcomes: [outcome({ tests: THREE, result: okResult({ passed: 3 }) })],
});

const S_FAILING = scenario("failing-run", {
  discovery: report({
    discovered: THREE_ENTRIES,
    groups: [group("/repo/crates/ledger", THREE)],
  }),
  outcomes: [
    outcome({
      tests: THREE,
      result: okResult({
        success: false,
        passed: 2,
        failed: 1,
        failures: [{ name: "ledger_totals_match", message: "assertion `left == right` failed\n  left: 4200\n right: 0" }],
      }),
    }),
  ],
});

const S_EXCLUDED = scenario("excluded", {
  discovery: report({
    discovered: [
      entry("settles_a_zero_balance", "/repo/crates/ledger/src/settle.rs", 1, NEAR.path, {
        excluded: { marker: IGNORED_MARKER, where: "declaration" },
      }),
      entry("ledger_totals_match", "/repo/crates/ledger/tests/ledger.rs", 2, MID.path, {
        excluded: { marker: ENCLOSING_MARKER, where: "enclosing" },
      }),
      entry(FAR.filter, FAR.filePath, FAR.distance, FAR.path),
    ],
    groups: [group("/repo/crates/ledger", [FAR])],
  }),
  outcomes: [outcome({ tests: [FAR], result: okResult({ passed: 1 }) })],
});

const S_UNRUNNABLE = scenario("unrunnable", {
  discovery: report({
    discovered: [
      entry("closure#0", "/repo/crates/ledger/tests/ledger.rs", 2, MID.path, {
        unrunnable: UNRUNNABLE_REASON,
      }),
      entry(NEAR.filter, NEAR.filePath, NEAR.distance, NEAR.path),
    ],
    groups: [group("/repo/crates/ledger", [NEAR])],
  }),
  outcomes: [outcome({ tests: [NEAR], result: okResult({ passed: 1 }) })],
});

const S_MANY_EXCLUSIONS = scenario("many-exclusions", {
  discovery: report({
    discovered: [
      entry("settles_a_zero_balance", "/repo/crates/ledger/src/settle.rs", 1, NEAR.path, {
        excluded: { marker: IGNORED_MARKER, where: "declaration" },
      }),
      entry("ledger_totals_match", "/repo/crates/ledger/tests/ledger.rs", 2, MID.path, {
        excluded: { marker: ENCLOSING_MARKER, where: "enclosing" },
      }),
      entry("end_to_end_month_close", "/repo/crates/ledger/tests/e2e.rs", 7, FAR.path, {
        excluded: { marker: IGNORED_MARKER, where: "declaration" },
      }),
      entry("closure#0", "/repo/crates/ledger/tests/e2e.rs", 4, MID.path, {
        unrunnable: UNRUNNABLE_REASON,
      }),
    ],
    groups: [],
  }),
  outcomes: [],
});

const S_NO_EXCLUSIONS = scenario("no-exclusions", {
  discovery: report({
    discovered: THREE_ENTRIES,
    groups: [group("/repo/crates/ledger", THREE)],
  }),
  outcomes: [outcome({ tests: THREE, result: okResult({ passed: 3 }) })],
});

// TypeScript: tsserver resolves the query to the FILE, so the discovered item is
// named for the file. The runner filter below is a real individual test name and
// rule 8 forbids the report from naming it.
const TS_FILTER = "settles a zero balance";
const TS_NEAR = rt(TS_FILTER, "/repo/src/settle.test.ts", 1, ["settle.test.ts", "settleBalance"]);
const TS_MID = rt("keeps the ledger balanced", "/repo/src/ledger.test.ts", 2, [
  "ledger.test.ts",
  "postLedger",
  "settleBalance",
]);
const S_TYPESCRIPT = scenario("typescript-files", {
  symbolName: SYMBOL,
  languageId: "typescript",
  scopeWord: "package",
  discovery: report({
    discovered: [
      entry("settle.test.ts", "/repo/src/settle.test.ts", 1, TS_NEAR.path),
      entry("ledger.test.ts", "/repo/src/ledger.test.ts", 2, TS_MID.path),
    ],
    groups: [
      group("/repo|/repo/src/settle.test.ts", [TS_NEAR], {
        frameworkId: "vitest",
        placement: placement({ runRoot: "/repo", targetPath: "/repo/src/settle.test.ts" }),
      }),
    ],
  }),
  outcomes: [outcome({ key: "/repo|/repo/src/settle.test.ts", frameworkName: "vitest", tests: [TS_NEAR], result: okResult({ passed: 2 }) })],
});

const noRun = (id, resultOver, frameworkName = "dotnet test") =>
  scenario(id, {
    discovery: report({
      discovered: THREE_ENTRIES,
      groups: [group("/repo/crates/ledger", THREE)],
    }),
    outcomes: [
      outcome({
        frameworkName,
        tests: THREE,
        result: okResult({
          ran: false,
          success: false,
          passed: 0,
          failed: 0,
          casesComplete: undefined,
          ...resultOver,
        }),
      }),
    ],
  });

const S_BUILD_ERROR = noRun("norun-build-error", {
  buildError: "error[E0308]: mismatched types\n  --> tests/ledger.rs:14:9",
}, "cargo test");
const S_FILTER_NOTHING = noRun("norun-filter-nothing", { filterMatchedNothing: true });
const S_ENVIRONMENT = noRun("norun-environment", {
  environmentError: "dotnet: command not found",
});
const S_UNCLASSIFIED = noRun("norun-unclassified", {
  stdout: "",
  stderr: "",
});

const S_SPAWN_FAILURE = scenario("spawn-failure", {
  discovery: report({
    discovered: THREE_ENTRIES,
    groups: [group("/repo/crates/ledger", THREE)],
  }),
  outcomes: [outcome({ tests: THREE, failure: "spawn cargo ENOENT" })],
});

// ------------------------------------------------------------- assertions

// Rule 3 names four of these verbatim in its Tests section ("assert the section
// contains none of 'is correct', 'works correctly', 'verified', 'proves'); the
// last two are the same claim in other clothes and rule 10 forbids any wording
// being improved into a bigger claim.
//
// CONTRACT GAP: this is a PLAIN substring ban, which is what the contract asks
// for, so even a negated honest sentence ("this does not prove it is correct")
// trips it. That is the contract's own choice, not this file's.
const BANNED = ["is correct", "works correctly", "verified", "proves", "proven correct", "guaranteed"];

const assertNoBanned = (text, where) => {
  const low = text.toLowerCase();
  for (const phrase of BANNED) {
    assert.ok(!low.includes(phrase), `${where}: must not say "${phrase}"\n--- text ---\n${text}`);
  }
};

// CONTRACT GAP: rule 10 is prose ("no wording anywhere may be improved into a
// bigger claim"), so it is bound here to a sentence-level check: a sentence may
// carry a claim word only if it also carries a negator. "It does not certify
// correctness" passes; "the function is correct" does not.
const CLAIM_WORD = /\b(correct|correctly|certified|certifies|certify|guarantee|guarantees|proves|proven|verifies|verified|bug-free|flawless)\b/i;
const NEGATOR = /\b(not|never|no|none|nothing|cannot|can't|doesn't|don't|isn't|without|neither|rather than|only)\b/i;

const assertNoCorrectnessClaim = (text, where) => {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const s of sentences) {
    if (!CLAIM_WORD.test(s)) continue;
    assert.ok(
      NEGATOR.test(s),
      `${where}: this sentence claims correctness with nothing negating it, which rule 10 forbids:\n  ${s.trim()}`,
    );
  }
};

// Rule 1's own sentence. Rule 2 exists so this never appears on a bounded walk.
// CONTRACT GAP: the contract quotes "no test in this <scopeWord> calls <symbol>,
// directly or through any caller I could reach"; these two probes bind to the
// load-bearing halves of that quote and not to its exact punctuation or to the
// trailing "I could reach".
const RULE1_HEAD = (scopeWord, symbol) =>
  new RegExp(`no test[^.\\n]*\\b${scopeWord}\\b[^.\\n]*\\b${symbol}\\b`, "i");
const RULE1_TRANSITIVE = /directly or through any caller/i;

const assertNotRule1Sentence = (r, scopeWord, symbol, where) => {
  assert.ok(
    !RULE1_TRANSITIVE.test(r.channel),
    `${where}: rule 1's "directly or through any caller" sentence on a bounded search states a budget as a fact\n--- channel ---\n${r.channel}`,
  );
  assert.ok(
    !RULE1_HEAD(scopeWord, symbol).test(r.channel),
    `${where}: rule 1's "no test in this ${scopeWord} calls ${symbol}" sentence must not appear when the walk was cut short\n--- channel ---\n${r.channel}`,
  );
  assert.ok(!RULE1_TRANSITIVE.test(r.toast), `${where}: the toast must not carry rule 1's sentence either`);
};

// A no-run or a zero must never READ as a pass.
const assertNotAPass = (r, where) => {
  assert.notStrictEqual(r.severity, "info", `${where}: an outcome that is not a pass must not toast as info`);
  assert.ok(
    !/\ball\s+tests?\s+passed\b|\beverything\s+passed\b|\btests?\s+passed\b\s*$/i.test(r.toast),
    `${where}: the toast reads as a pass: ${r.toast}`,
  );
  assertNoBanned(r.channel, `${where} channel`);
  assertNoBanned(r.toast, `${where} toast`);
};

const has = (text, re, msg) => assert.ok(re.test(text), `${msg}\n--- text ---\n${text}`);
const hasNot = (text, re, msg) => assert.ok(!re.test(text), `${msg}\n--- text ---\n${text}`);

// ------------------------------------------------------------- rule 1

test("rule 1: a proven zero names the direct AND the transitive case, says the run proved nothing, and warns [B1 rule 1]", () => {
  const r = renderRunTestsReport(S_PROVEN_ZERO);

  has(r.channel, RULE1_HEAD("crate", RUST_SYMBOL), "the proven zero must say no test in this crate calls the symbol");
  has(
    r.channel,
    RULE1_TRANSITIVE,
    "the proven zero must name the transitive case too, not only the direct one (contract quote: 'directly or through any caller I could reach')",
  );
  // CONTRACT GAP: "it must add that the run therefore proved nothing about
  // behaviour" is prose; bound to any sentence saying nothing was established.
  has(
    r.channel,
    /(prov(?:ed|es|ing)?|says?|shows?|establish(?:ed|es)?)\s+nothing|nothing (?:was |is )?(?:proved|shown|established)|nothing about (?:its |the )?behaviou?r/i,
    "the proven zero must add that the run therefore proved nothing about behaviour",
  );
  assert.strictEqual(r.severity, "warning", "a zero that toasts as info reads like a pass; rule 1 fixes severity at warning");
  assert.notStrictEqual(r.severity, "info", "rule 1: NOT an information toast");
  assertNotAPass(r, "rule 1 proven zero");
});

// ------------------------------------------------------------- rule 2

const BOUNDED_CAUSE = {
  requests: { re: /request/i, what: "the request cap" },
  // CONTRACT GAP: "the node cap" is the walk's internal word; a plain-English
  // rendering of the same cap ("how many callers it may hold at once") names it
  // just as honestly, so the probe accepts either.
  nodes: { re: /\bnode|how many callers|callers? (?:it may )?hold|callers? (?:examined|admitted)/i, what: "the node cap" },
  depth: { re: /\bdepth\b|\bdeep(?:er|est)?\b|\bhops?\b/i, what: "the depth cap" },
  cancelled: { re: /cancel/i, what: "a cancel" },
  "hang-guard": { re: /hang|guard|timed out|time limit|took too long/i, what: "the hang guard" },
};

for (const [stop, { re, what }] of Object.entries(BOUNDED_CAUSE)) {
  test(`rule 2: a walk stopped by "${stop}" names ${what} and never uses rule 1's sentence [B1 rule 2]`, () => {
    const r = renderRunTestsReport(S_BOUNDED[stop]);

    // CONTRACT GAP: "the search was cut short" is prose; bound to any phrasing
    // that says the search did not finish.
    has(
      r.channel,
      /cut short|did not finish|incomplete|not exhaustive|stopped|ran out|budget|within the (?:budget|bounds?|limit)/i,
      `rule 2 (${stop}): the report must say the search was cut short`,
    );
    has(r.channel, re, `rule 2 (${stop}): the report must NAME ${what}`);
    assertNotRule1Sentence(r, "crate", RUST_SYMBOL, `rule 2 (${stop})`);
    assertNotAPass(r, `rule 2 (${stop})`);
  });
}

test("rule 2: a caller the server could not resolve is a bounded zero, not a proven one [B1 rule 2]", () => {
  const r = renderRunTestsReport(S_FAILED_REQUESTS);

  // CONTRACT GAP: bound to "could not resolve / failed / rejected", the honest
  // vocabularies for a resolveCallers rejection. See the fixture's note on the
  // A2-rule-4 vs B1-rule-2 tension.
  has(
    r.channel,
    /could not (?:be )?resolve|unresolved|fail(?:ed|ure)|reject|did not answer|no answer/i,
    "rule 2: a rejected caller query must be NAMED as what cut the search short",
  );
  assertNotRule1Sentence(r, "crate", RUST_SYMBOL, "rule 2 (failed requests)");
  assertNotAPass(r, "rule 2 (failed requests)");
});

// ------------------------------------------------------------- rule 3

test("rule 3: a green run states the passed count and claims no correctness [B1 rule 3]", () => {
  const r = renderRunTestsReport(S_GREEN);
  const both = `${r.channel}\n${r.toast}`;

  for (const phrase of BANNED) {
    assert.ok(
      !both.toLowerCase().includes(phrase),
      `rule 3: a green run must not say "${phrase}"\n--- text ---\n${both}`,
    );
  }
  assertNoCorrectnessClaim(both, "rule 3 green run");

  // Contract quote: "<N> covering test(s) passed".
  has(r.channel, /\b3\b/, "rule 3: the green run must state the passed count");
  has(r.channel, /\bpassed\b/i, "rule 3: the green run says the tests passed");
  has(r.channel, /covering/i, "rule 3: they are COVERING tests, which is the whole claim being made");
  // "the report says how far away they were" - distances present on a green run.
  // CONTRACT GAP: "the report says how far away they were" is bound to a
  // distance word or a `dN` column, not to a bare digit.
  has(
    r.channel,
    /\bdistance\b|\bd\d\b|\bhops?\b|\baway\b/i,
    "rule 3: a green run still reports how far away the tests were",
  );
});

// ------------------------------------------------------------- rule 4

test("rule 4: every distance and every call path is reported, nearest first [B1 rule 4]", () => {
  const r = renderRunTestsReport(S_DISTANCES);
  const c = r.channel;

  for (const t of THREE) {
    assert.ok(c.includes(t.filter), `rule 4: ${t.filter} must appear in the channel`);
    // CONTRACT GAP: "listed with its distance" is prose; bound to the distance
    // number appearing near a distance word on the line that names the test.
    const line = c.split("\n").find((l) => l.includes(t.filter));
    assert.ok(line !== undefined, `rule 4: ${t.filter} needs its own line`);
    has(
      line,
      new RegExp(
        `(?:distance|hops?|away|deep)\\D{0,12}${t.distance}\\b|\\b${t.distance}\\s*(?:hops?|away|deep)|(?:^|[^\\w])d${t.distance}\\b`,
        "i",
      ),
      `rule 4: the line for ${t.filter} must state distance ${t.distance}`,
    );
  }

  // The call path, every node of it.
  for (const t of THREE) {
    for (const node of t.path) {
      assert.ok(c.includes(node), `rule 4: the call path node ${node} must appear`);
    }
  }
  // CONTRACT GAP: the contract does not fix a path separator; bound to any of
  // the arrow forms a path rendering could use.
  has(c, /->|→|<-|←|»|›/, "rule 4: the call path must be rendered as a path, not as bare names");

  // Nearest first.
  const iNear = c.indexOf(NEAR.filter);
  const iMid = c.indexOf(MID.filter);
  const iFar = c.indexOf(FAR.filter);
  assert.ok(iNear < iMid, "rule 4: distance 1 must be listed before distance 2");
  assert.ok(iMid < iFar, "rule 4: distance 2 must be listed before distance 7");

  // A far test is a fact about the code's shape, not something to hide.
  // CONTRACT GAP: same binding as the per-line probe - a `d7` column states the
  // distance as plainly as the word does.
  has(
    c,
    /(?:^|[^\w])d7\b|distance\D{0,12}7\b|\b7\s*(?:hops?|away|deep)/i,
    "rule 4: the distance-7 test keeps its distance rather than having it hidden",
  );
  // "the channel says which of them are near". CONTRACT GAP: bound to the word,
  // since the contract fixes no phrasing for the near/far distinction.
  has(c, /\bnear(?:est|er|by)?\b|\bclosest\b/i, "rule 4: the channel must say which of the tests are near");
  assertNoCorrectnessClaim(c, "rule 4");
});

// ------------------------------------------------------------- rule 5

test("rule 5: excluded tests are listed under a found-but-not-run heading, marker quoted, where stated [B1 rule 5]", () => {
  const r = renderRunTestsReport(S_EXCLUDED);
  const c = r.channel;

  // CONTRACT GAP: "under a heading that says they were found and NOT run" is
  // prose; bound to a line carrying both notions.
  const heading = c
    .split("\n")
    .find((l) => /found/i.test(l) && /not run|were not run|skipped|excluded/i.test(l));
  assert.ok(
    heading !== undefined,
    `rule 5: needs a heading saying the excluded tests were FOUND and NOT run\n--- channel ---\n${c}`,
  );

  assert.ok(c.includes(IGNORED_MARKER), `rule 5: the marker ${IGNORED_MARKER} must be quoted`);
  assert.ok(c.includes(ENCLOSING_MARKER), `rule 5: the marker ${ENCLOSING_MARKER} must be quoted`);
  assert.ok(c.includes("settles_a_zero_balance"), "rule 5: the excluded test is named");
  assert.ok(c.includes("ledger_totals_match"), "rule 5: the excluded test is named");

  // CONTRACT GAP: "whether it sat on the test or on the type around it" is
  // prose; bound to the two `where` words or their plain-English equivalents.
  has(
    c,
    /declaration|on the test itself|on its own/i,
    "rule 5: a marker on the test's own declaration must say so",
  );
  has(
    c,
    /enclosing|around it|surrounding|the type|the module/i,
    "rule 5: a marker on the enclosing type must say so",
  );
  assertNoCorrectnessClaim(c, "rule 5");
});

// ------------------------------------------------------------- rule 6

test("rule 6: unrunnable tests are listed with their reason, not silently dropped [B1 rule 6]", () => {
  const r = renderRunTestsReport(S_UNRUNNABLE);
  const c = r.channel;

  const heading = c
    .split("\n")
    .find((l) => /found/i.test(l) && /not run|were not run|could not (?:be )?run|unrunnable/i.test(l));
  assert.ok(
    heading !== undefined,
    `rule 6: needs a heading saying the unrunnable tests were FOUND and NOT run\n--- channel ---\n${c}`,
  );
  assert.ok(c.includes("closure#0"), "rule 6: the unrunnable test is named");
  // CONTRACT GAP: bound to the reason's own load-bearing words rather than the
  // whole string, so a rendering may wrap or re-case it.
  has(c, /cannot become a runner filter|runner filter/i, "rule 6: the reason must be stated");
  assertNoCorrectnessClaim(c, "rule 6");
});

// ------------------------------------------------------------- rule 7

// CONTRACT GAP: "the channel says so once" is prose; the floor sentence is
// recognised by these markers rather than by an exact phrasing. The per-test
// rule-5 lines ("marker on the declaration") deliberately do not match.
const FLOOR_RE = /\bfloor\b|not a guarantee|is all that is available|only the declaration|declaration text is all|cannot see past/i;

test("rule 7: the filter-is-a-floor sentence is said exactly ONCE, not once per excluded test [B1 rule 7]", () => {
  const r = renderRunTestsReport(S_MANY_EXCLUSIONS);
  const lines = r.channel.split("\n").filter((l) => FLOOR_RE.test(l));
  assert.strictEqual(
    lines.length,
    1,
    `rule 7: with 3 exclusions and 1 unrunnable the floor sentence must appear exactly once, got ${lines.length}\n--- matches ---\n${lines.join("\n")}\n--- channel ---\n${r.channel}`,
  );
  // The substance of it: declaration text is all discovery could see.
  has(
    r.channel,
    /declaration|floor|not a guarantee/i,
    "rule 7: the floor sentence explains that only declaration text was available",
  );
});

test("rule 7: the floor sentence is never repeated on a run with nothing excluded [B1 rule 7]", () => {
  const r = renderRunTestsReport(S_NO_EXCLUSIONS);
  const lines = r.channel.split("\n").filter((l) => FLOOR_RE.test(l));
  assert.ok(
    lines.length <= 1,
    `rule 7: the floor sentence is said at most once, got ${lines.length}\n--- matches ---\n${lines.join("\n")}`,
  );
});

// ------------------------------------------------------------- rule 8

test("rule 8: the TypeScript report names FILES, prints no call path, and admits the file may not reach the function [B1 rule 8]", () => {
  const r = renderRunTestsReport(S_TYPESCRIPT);
  const c = r.channel;

  assert.ok(c.includes("settle.test.ts"), "rule 8: the TS report names the test FILE");
  assert.ok(c.includes("ledger.test.ts"), "rule 8: every discovered test file is named");

  // Rule 8 forbids naming an individual test. The fixture's runner filter IS an
  // individual test name, so its absence is the check.
  assert.ok(
    !c.includes(TS_FILTER),
    `rule 8: the TS report must not name an individual test, and "${TS_FILTER}" is one\n--- channel ---\n${c}`,
  );
  assert.ok(!c.includes("keeps the ledger balanced"), "rule 8: no individual test names in the TS report");

  // CONTRACT GAP: "does not print a call path ending at a test name" is bound to
  // the stronger, checkable form: the TS report prints no call path at all,
  // because tsserver resolved to a file and a file is not a call-path node.
  hasNot(c, /->|→|<-|←/, "rule 8: tsserver resolves to a Module item, so there is no call path to print");

  // CONTRACT GAP: "the file may contain tests that do not reach the function" is
  // prose; bound to any phrasing of that caveat.
  has(
    c,
    /may (?:also )?contain tests that (?:do not|don't|never|might not) reach|not every test in (?:the|this) file|some(?: of the)? tests in (?:the|this) file (?:may|might) not/i,
    "rule 8: the TS report must say the file may contain tests that do not reach the function",
  );
  assertNoCorrectnessClaim(c, "rule 8");
});

// ------------------------------------------------------------- rule 9

// CONTRACT GAP: rule 9 says each no-run outcome reuses "the shipped reportNoRun
// wording rather than inventing a second vocabulary". Each row below binds to
// the load-bearing phrase of the shipped sentence for that outcome, not to the
// whole sentence.
const NO_RUN_ROWS = [
  {
    id: "build error",
    fixture: S_BUILD_ERROR,
    cause: /did not compile|failed to compile|compile error|build (?:error|failure)/i,
    forbidden: null,
  },
  {
    id: "filter matched nothing",
    fixture: S_FILTER_NOTHING,
    cause: /matched no(?:thing| tests?)|selected none|selected zero|zero tests ran|no tests? (?:were )?selected/i,
    // The shipped wording is explicit that this is NOT a compile failure.
    forbidden: /did not compile|failed to compile/i,
  },
  {
    id: "environment error",
    fixture: S_ENVIRONMENT,
    cause: /could not start|failed to start|unable to start|runner could not run/i,
    // Shipped comment: nothing was built, so the word "compile" must not appear.
    forbidden: /compile/i,
  },
  {
    id: "unclassified",
    fixture: S_UNCLASSIFIED,
    cause: /produced no result|no result|no test, no failure and no reason|reported nothing/i,
    forbidden: /did not compile|could not start/i,
  },
];

for (const row of NO_RUN_ROWS) {
  test(`rule 9: "${row.id}" names its own cause and does not read as a pass [B1 rule 9]`, () => {
    const r = renderRunTestsReport(row.fixture);
    const both = `${r.channel}\n${r.toast}`;

    has(both, row.cause, `rule 9 (${row.id}): the report must name this cause in its own words`);
    if (row.forbidden) {
      hasNot(both, row.forbidden, `rule 9 (${row.id}): this outcome must not borrow another outcome's sentence`);
    }
    assertNotAPass(r, `rule 9 (${row.id})`);
    hasNot(
      both,
      /\b(?:3|all)\s+covering tests? passed\b/i,
      `rule 9 (${row.id}): a run that did not run cannot report passes`,
    );
    assert.ok(
      r.severity === "warning" || r.severity === "error",
      `rule 9 (${row.id}): severity must be warning or error, got ${r.severity}`,
    );
    assertNoCorrectnessClaim(both, `rule 9 (${row.id})`);
  });
}

test("a failing run names the failing test and is not toasted as info [B1 rules 3 + 9]", () => {
  const r = renderRunTestsReport(S_FAILING);
  assert.ok(r.channel.includes("ledger_totals_match"), "the failing test must be named");
  assertNotAPass(r, "failing run");
});

test("a group that could not be spawned is reported, not silently dropped [B1 rules 6 + 9]", () => {
  const r = renderRunTestsReport(S_SPAWN_FAILURE);
  has(r.channel, /spawn cargo ENOENT|could not (?:be )?run|failed to run|did not run/i, "the spawn failure must be reported");
  assertNotAPass(r, "spawn failure");
});

// ------------------------------------------------------------- rule 10

test("rule 10: no fixture anywhere produces wording that certifies the function [B1 rule 10]", () => {
  for (const { id, input: inp } of SCENARIOS) {
    const r = renderRunTestsReport(inp);
    assertNoBanned(r.channel, `rule 10 [${id}] channel`);
    assertNoBanned(r.toast, `rule 10 [${id}] toast`);
    assertNoCorrectnessClaim(r.channel, `rule 10 [${id}] channel`);
    assertNoCorrectnessClaim(r.toast, `rule 10 [${id}] toast`);
  }
});

// -------------------------------------------------- toast, determinism, purity

for (const { id, input: inp } of SCENARIOS) {
  test(`the toast for "${id}" is one sentence plus at most a pointer [B1 RunTestsReport.toast]`, () => {
    const r = renderRunTestsReport(inp);
    assert.strictEqual(typeof r.toast, "string");
    assert.ok(r.toast.trim().length > 0, `[${id}]: the toast must say something`);
    assert.ok(!r.toast.includes("\n"), `[${id}]: a toast is one line, got:\n${r.toast}`);
    assert.ok(r.toast.length <= 240, `[${id}]: the toast is ${r.toast.length} chars, which is not one sentence: ${r.toast}`);
    // WIDENED, on this row's own advice. The contract line said "never longer
    // than one sentence plus a pointer", and the no-run paths cannot obey that
    // and rule 9 at once: "no covering test actually ran - the tests did not
    // compile. This is not a pass. See the output channel." is three sentences,
    // and the middle clause is the one that stops a run which executed nothing
    // from reading like a pass. The contract line moved (see
    // session-v60/contracts/phaseB1-run-tests.md, RunTestsReport.toast); the
    // clause stayed. Two breaks is the widened bound: the required clause, and
    // the channel pointer.
    const boundaries = r.toast.match(/[.!?]\s+[A-Z]/g) || [];
    assert.ok(
      boundaries.length <= 2,
      `[${id}]: the widened contract allows at most two sentence breaks (the required not-a-pass clause, and the pointer), found ${boundaries.length}: ${r.toast}`,
    );
    assert.ok(
      ["info", "warning", "error"].includes(r.severity),
      `[${id}]: severity must be one of info|warning|error, got ${r.severity}`,
    );
    assert.strictEqual(typeof r.channel, "string", `[${id}]: the channel is a string`);
    assert.ok(r.channel.length > 0, `[${id}]: the channel transcript must say something`);
  });
}

test("deterministic: the same input renders a byte-identical channel and toast [A2 rule 6]", () => {
  for (const { id, input: inp } of SCENARIOS) {
    const a = renderRunTestsReport(inp);
    const b = renderRunTestsReport(inp);
    assert.strictEqual(a.channel, b.channel, `[${id}]: channel is not deterministic`);
    assert.strictEqual(a.toast, b.toast, `[${id}]: toast is not deterministic`);
    assert.strictEqual(a.severity, b.severity, `[${id}]: severity is not deterministic`);
  }
});

test("pure: renderRunTestsReport mutates nothing it was handed [A2 rule 8 'no mutation of the input']", () => {
  for (const { id, input: inp } of SCENARIOS) {
    const before = JSON.stringify(inp);
    renderRunTestsReport(inp);
    assert.strictEqual(JSON.stringify(inp), before, `[${id}]: the input was mutated`);
  }
});

test("total: renderRunTestsReport never throws, including on degenerate input", () => {
  const degenerate = [
    input({}),
    input({ symbolName: "", scopeWord: "", languageId: "" }),
    input({ languageId: "cobol", scopeWord: "module" }),
    input({ outcomes: [outcome({ tests: [] })] }),
    input({ discovery: report({ provenZero: true }), outcomes: [outcome({ tests: THREE, result: okResult() })] }),
    input({
      discovery: report({ discovered: THREE_ENTRIES, groups: [group("/repo/crates/ledger", THREE)] }),
      outcomes: [],
    }),
  ];
  for (const [i, inp] of [...SCENARIOS.map((s) => s.input), ...degenerate].entries()) {
    const r = renderRunTestsReport(inp);
    assert.strictEqual(typeof r.channel, "string", `input ${i}: channel`);
    assert.strictEqual(typeof r.toast, "string", `input ${i}: toast`);
  }
});
