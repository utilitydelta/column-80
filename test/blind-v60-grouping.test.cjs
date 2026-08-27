// BLIND ORACLE: run grouping and the discovery facade (session-v60 phase A2).
//
// Written from `session-v60/contracts/phaseA2-transport-and-grouping.md` alone,
// with the phase A1 contract (`phaseA-callwalk.md`) for the input types. The
// implementation of `src/core/testRunGroup.ts` and `src/core/testDiscovery.ts`
// has NOT been read, and `src/vscode/callHierarchy.ts` is out of scope here: it
// imports vscode and cannot load headless.
//
// Only the two PURE modules are exercised. Expected RED until phase A2 exists.
//
// Run: SKIP_LIVE=1 node --test test/blind-v60-grouping.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// The modules may not exist yet. Bundle defensively so each contract rule
// reports as its own failing test instead of one opaque load error.
let groupTestRuns;
let discoverCoveringTests;
let cleanup = () => {};
try {
  const bundled = bundleCore(
    "blind-v60-grouping",
    `export { groupTestRuns } from "../src/core/testRunGroup";
export { discoverCoveringTests } from "../src/core/testDiscovery";\n`,
  );
  cleanup = bundled.cleanup;
  groupTestRuns = bundled.mod.groupTestRuns;
  discoverCoveringTests = bundled.mod.discoverCoveringTests;
} catch (err) {
  const boom = () => {
    throw new Error(`phase A2 modules did not load: ${err && err.message}`);
  };
  groupTestRuns = boom;
  discoverCoveringTests = async () => boom();
}
test.after(() => cleanup());

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** A RunnableTest, contract §3. */
const rt = (filter, filePath, distance, path) => ({
  filter,
  filePath,
  distance,
  path: path ?? [filter, "target"],
});

/** A TestPlacement, shaped from src/core/tddLang.ts. Only runRoot, packageArg
 *  and targetPath are load-bearing for grouping; the rest are carried through. */
const placement = (over = {}) => ({
  targetPath: over.targetPath ?? "/repo/tests/a_test.rs",
  exists: over.exists ?? true,
  mode: over.mode ?? "same-file",
  runRoot: over.runRoot ?? "/repo",
  ...over,
});

/** A resolveTarget that answers from a table and records every call. */
function targets(table, frameworkId = "libtest") {
  const calls = [];
  return {
    calls,
    resolve: (filePath) => {
      calls.push(filePath);
      const entry = table[filePath];
      if (entry === undefined) return { ok: false, reason: `no run target for ${filePath}` };
      if (entry.refuse) return { ok: false, reason: entry.refuse };
      return {
        ok: true,
        // A FRESH object per call, so a determinism check is a real one.
        placement: placement({ ...entry, refuse: undefined }),
        frameworkId: entry.frameworkId ?? frameworkId,
      };
    },
  };
}

/** Contract §3 rule 2: no group is ever emitted with zero members. Asserted on
 *  EVERY grouping result in this file, not just the dedicated case. */
function assertNoEmptyGroup(res, where) {
  for (const g of res.groups) {
    assert.ok(Array.isArray(g.tests), `${where}: a group must carry a tests array`);
    assert.ok(g.tests.length > 0, `${where}: an empty group would make the runner throw`);
  }
}

const group = (input) => {
  const res = groupTestRuns(input);
  assertNoEmptyGroup(res, "groupTestRuns");
  return res;
};

const filtersOf = (g) => g.tests.map((t) => t.filter);
const allGroupedFilters = (res) => res.groups.flatMap(filtersOf);

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const v of Object.values(value)) deepFreeze(v, seen);
  return Object.freeze(value);
}

// ===========================================================================
// groupTestRuns — contract §3
// ===========================================================================

// --- rule 1: the key comes from runScope and nothing else -------------------

test("runScope root: tests across MANY FILES collapse into ONE group [A2 §3 rule 1, Rust/libtest]", () => {
  const t = targets({
    "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" },
    "/repo/src/b.rs": { targetPath: "/repo/src/b.rs", runRoot: "/repo" },
    "/repo/tests/c.rs": { targetPath: "/repo/tests/c.rs", runRoot: "/repo" },
    "/repo/tests/d.rs": { targetPath: "/repo/tests/d.rs", runRoot: "/repo" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [
      rt("test_a", "/repo/src/a.rs", 1),
      rt("test_b", "/repo/src/b.rs", 2),
      rt("test_c", "/repo/tests/c.rs", 2),
      rt("test_d", "/repo/tests/d.rs", 3),
    ],
  });
  assert.strictEqual(res.groups.length, 1, "one crate is one spawn however many files");
  assert.deepStrictEqual(filtersOf(res.groups[0]), ["test_a", "test_b", "test_c", "test_d"]);
  assert.deepStrictEqual(res.unrunnable, []);
});

test("runScope root: two DIFFERENT runRoots stay apart, because the key IS the runRoot [A2 §3 rule 1]", () => {
  const t = targets({
    "/one/src/a.rs": { targetPath: "/one/src/a.rs", runRoot: "/one" },
    "/two/src/b.rs": { targetPath: "/two/src/b.rs", runRoot: "/two" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [rt("test_a", "/one/src/a.rs", 1), rt("test_b", "/two/src/b.rs", 1)],
  });
  assert.strictEqual(res.groups.length, 2);
  assert.notStrictEqual(res.groups[0].key, res.groups[1].key);
});

test("runScope file: the same tests give ONE GROUP PER FILE [A2 §3 rule 1, Python/TypeScript]", () => {
  const t = targets({
    "/repo/tests/a_test.py": { targetPath: "/repo/tests/a_test.py", runRoot: "/repo" },
    "/repo/tests/b_test.py": { targetPath: "/repo/tests/b_test.py", runRoot: "/repo" },
    "/repo/tests/c_test.py": { targetPath: "/repo/tests/c_test.py", runRoot: "/repo" },
  });
  const res = group({
    runScope: "file",
    resolveTarget: t.resolve,
    tests: [
      rt("test_a1", "/repo/tests/a_test.py", 1),
      rt("test_a2", "/repo/tests/a_test.py", 2),
      rt("test_b1", "/repo/tests/b_test.py", 1),
      rt("test_c1", "/repo/tests/c_test.py", 3),
    ],
  });
  assert.strictEqual(res.groups.length, 3, "pytest is asked one file at a time");
  const byPath = new Map(res.groups.map((g) => [g.placement.targetPath, filtersOf(g)]));
  assert.deepStrictEqual(byPath.get("/repo/tests/a_test.py"), ["test_a1", "test_a2"]);
  assert.deepStrictEqual(byPath.get("/repo/tests/b_test.py"), ["test_b1"]);
  assert.deepStrictEqual(byPath.get("/repo/tests/c_test.py"), ["test_c1"]);
  assert.strictEqual(new Set(res.groups.map((g) => g.key)).size, 3, "keys are distinct per file");
});

test("runScope package: same runRoot + same packageArg collapse, a second package stays apart [A2 §3 rule 1, Go/C#]", () => {
  const t = targets({
    "/mod/internal/pay/a_test.go": { targetPath: "/mod/internal/pay/a_test.go", runRoot: "/mod", packageArg: "./internal/pay" },
    "/mod/internal/pay/b_test.go": { targetPath: "/mod/internal/pay/b_test.go", runRoot: "/mod", packageArg: "./internal/pay" },
    "/mod/internal/ship/c_test.go": { targetPath: "/mod/internal/ship/c_test.go", runRoot: "/mod", packageArg: "./internal/ship" },
  });
  const res = group({
    runScope: "package",
    resolveTarget: t.resolve,
    tests: [
      rt("TestA", "/mod/internal/pay/a_test.go", 1),
      rt("TestB", "/mod/internal/pay/b_test.go", 2),
      rt("TestC", "/mod/internal/ship/c_test.go", 1),
    ],
  });
  assert.strictEqual(res.groups.length, 2, "two packages, two spawns; two FILES in one package share one");
  const pay = res.groups.find((g) => g.placement.packageArg === "./internal/pay");
  const ship = res.groups.find((g) => g.placement.packageArg === "./internal/ship");
  assert.ok(pay && ship, "both packages present");
  assert.deepStrictEqual(filtersOf(pay), ["TestA", "TestB"]);
  assert.deepStrictEqual(filtersOf(ship), ["TestC"]);
});

test("runScope package: the same packageArg under DIFFERENT runRoots does not collapse [A2 §3 rule 1]", () => {
  const t = targets({
    "/modA/internal/pay/a_test.go": { targetPath: "/modA/internal/pay/a_test.go", runRoot: "/modA", packageArg: "./internal/pay" },
    "/modB/internal/pay/b_test.go": { targetPath: "/modB/internal/pay/b_test.go", runRoot: "/modB", packageArg: "./internal/pay" },
  });
  const res = group({
    runScope: "package",
    resolveTarget: t.resolve,
    tests: [rt("TestA", "/modA/internal/pay/a_test.go", 1), rt("TestB", "/modB/internal/pay/b_test.go", 1)],
  });
  assert.strictEqual(res.groups.length, 2, "the key is runRoot joined with packageArg, not packageArg alone");
});

test("runScope package: a missing packageArg is the empty string, so those files share one key [A2 §3 rule 1]", () => {
  // CONTRACT GAP: the key's separator/format is unspecified ("joined with"), so
  // nothing here asserts the literal key string - only which tests share a key.
  const t = targets({
    "/proj/a.cs": { targetPath: "/proj/a.cs", runRoot: "/proj" },
    "/proj/b.cs": { targetPath: "/proj/b.cs", runRoot: "/proj" },
  });
  const res = group({
    runScope: "package",
    resolveTarget: t.resolve,
    tests: [rt("N.A", "/proj/a.cs", 1), rt("N.B", "/proj/b.cs", 1)],
  });
  assert.strictEqual(res.groups.length, 1, "packageArg ?? '' makes these one key");
  assert.deepStrictEqual(filtersOf(res.groups[0]), ["N.A", "N.B"]);
});

test("runScope file distinguishes files that runScope root merges: the key reads NOTHING but runScope [A2 §3 rule 1]", () => {
  const table = {
    "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo", packageArg: "./a" },
    "/repo/src/b.rs": { targetPath: "/repo/src/b.rs", runRoot: "/repo", packageArg: "./b" },
  };
  const tests = [rt("test_a", "/repo/src/a.rs", 1), rt("test_b", "/repo/src/b.rs", 1)];
  const asRoot = group({ runScope: "root", resolveTarget: targets(table).resolve, tests });
  const asPackage = group({ runScope: "package", resolveTarget: targets(table).resolve, tests });
  const asFile = group({ runScope: "file", resolveTarget: targets(table).resolve, tests });
  assert.strictEqual(asRoot.groups.length, 1, "root ignores packageArg and targetPath");
  assert.strictEqual(asPackage.groups.length, 2, "package reads packageArg");
  assert.strictEqual(asFile.groups.length, 2, "file reads targetPath");
});

// --- rule 2: never an empty group -------------------------------------------

test("no group is emitted for a file that resolves but contributes no test [A2 §3 rule 2]", () => {
  // CONTRACT GAP: a group is only ever seeded by a test, so "a file that
  // resolves and contributes nothing" can only be reached from the outside -
  // an input with no tests at all, and a file whose tests all end up elsewhere
  // (unrunnable). The reading tested is the invariant itself: NO result of
  // groupTestRuns ever carries a zero-member group, and resolveTarget is not
  // even consulted for a file with no test in it.
  const t = targets({
    "/repo/tests/live_test.py": { targetPath: "/repo/tests/live_test.py", runRoot: "/repo" },
    "/repo/tests/a_test.py": { targetPath: "/repo/tests/a_test.py", runRoot: "/repo" },
  });
  const empty = group({ runScope: "file", resolveTarget: t.resolve, tests: [] });
  assert.deepStrictEqual(empty.groups, [], "no tests means no spawns");
  assert.deepStrictEqual(empty.unrunnable, []);
  assert.deepStrictEqual(t.calls, [], "a file with no test in it is never resolved");

  // And the file that DID resolve is the only group, with real members.
  const one = group({
    runScope: "file",
    resolveTarget: t.resolve,
    tests: [rt("test_a", "/repo/tests/a_test.py", 1)],
  });
  assert.strictEqual(one.groups.length, 1);
  assert.strictEqual(one.groups[0].tests.length, 1);
});

// --- rule 3: dedup keeps the shortest distance AND ITS path -----------------

test("duplicate filters in one group dedup to ONE, keeping the shortest distance AND that distance's path [A2 §3 rule 3]", () => {
  const t = targets({ "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" } });
  const long = rt("works", "/repo/src/a.rs", 3, ["works", "via_helper", "via_inner", "target"]);
  const short = rt("works", "/repo/src/a.rs", 1, ["works", "target"]);
  const res = group({ runScope: "root", resolveTarget: t.resolve, tests: [long, short] });

  assert.strictEqual(res.groups.length, 1);
  assert.strictEqual(res.groups[0].tests.length, 1, "one filter is one name in the runner's list");
  const kept = res.groups[0].tests[0];
  assert.strictEqual(kept.distance, 1, "the shortest distance survives");
  assert.deepStrictEqual(
    kept.path,
    ["works", "target"],
    "the path must be the SHORT distance's path - short number with the long path is the bug",
  );
});

test("dedup is order-independent: the shortest wins whichever arrives first [A2 §3 rule 3]", () => {
  const t = targets({ "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" } });
  const long = rt("works", "/repo/src/a.rs", 4, ["works", "w", "x", "y", "target"]);
  const short = rt("works", "/repo/src/a.rs", 2, ["works", "z", "target"]);
  for (const order of [[long, short], [short, long]]) {
    const res = group({ runScope: "root", resolveTarget: t.resolve, tests: order });
    assert.strictEqual(res.groups[0].tests.length, 1);
    assert.strictEqual(res.groups[0].tests[0].distance, 2);
    assert.deepStrictEqual(res.groups[0].tests[0].path, ["works", "z", "target"]);
  }
});

test("the SAME filter in two DIFFERENT groups is kept in both [A2 §3 rule 3 is per-group]", () => {
  const t = targets({
    "/repo/tests/a_test.py": { targetPath: "/repo/tests/a_test.py", runRoot: "/repo" },
    "/repo/tests/b_test.py": { targetPath: "/repo/tests/b_test.py", runRoot: "/repo" },
  });
  const res = group({
    runScope: "file",
    resolveTarget: t.resolve,
    tests: [rt("test_reads", "/repo/tests/a_test.py", 1), rt("test_reads", "/repo/tests/b_test.py", 2)],
  });
  assert.strictEqual(res.groups.length, 2);
  assert.ok(res.groups.every((g) => g.tests.length === 1));
});

test("a C# overload pair normalising to one filter costs one name, not two [A2 §3 rule 3]", () => {
  const t = targets({ "/sln/Tests/T.cs": { targetPath: "/sln/Tests/T.cs", runRoot: "/sln/Tests", packageArg: "/sln/Tests/T.csproj" } }, "xunit");
  const res = group({
    runScope: "package",
    resolveTarget: t.resolve,
    tests: [
      rt("T.Adds", "/sln/Tests/T.cs", 2, ["T.Adds(int)", "target"]),
      rt("T.Adds", "/sln/Tests/T.cs", 2, ["T.Adds(string)", "target"]),
    ],
  });
  assert.strictEqual(res.groups[0].tests.length, 1, "--filter A|B must not name A twice");
});

// --- rule 4: group order by minimum member distance, key tiebreak ------------

test("groups are ordered by the MINIMUM distance of their members, ascending [A2 §3 rule 4]", () => {
  const t = targets({
    "/repo/far.py": { targetPath: "/repo/far.py", runRoot: "/repo" },
    "/repo/near.py": { targetPath: "/repo/near.py", runRoot: "/repo" },
    "/repo/mid.py": { targetPath: "/repo/mid.py", runRoot: "/repo" },
  });
  const res = group({
    runScope: "file",
    resolveTarget: t.resolve,
    tests: [
      rt("test_far", "/repo/far.py", 5),
      rt("test_far2", "/repo/far.py", 6),
      rt("test_near", "/repo/near.py", 1),
      rt("test_near2", "/repo/near.py", 9),
      rt("test_mid", "/repo/mid.py", 3),
    ],
  });
  assert.deepStrictEqual(
    res.groups.map((g) => g.placement.targetPath),
    ["/repo/near.py", "/repo/mid.py", "/repo/far.py"],
    "the nearest evidence runs first, and a group's rank is its MINIMUM member",
  );
});

test("a genuine tie on minimum distance breaks on key, and the order is stable [A2 §3 rule 4]", () => {
  // Same runRoot in both, so ordering by key reduces to ordering by targetPath
  // whatever separator the key uses. CONTRACT GAP: the key string's format is
  // unspecified, so only the ORDER it produces is asserted, never its text.
  const table = {
    "/repo/aaa_test.py": { targetPath: "/repo/aaa_test.py", runRoot: "/repo" },
    "/repo/bbb_test.py": { targetPath: "/repo/bbb_test.py", runRoot: "/repo" },
    "/repo/ccc_test.py": { targetPath: "/repo/ccc_test.py", runRoot: "/repo" },
  };
  // Fed deliberately out of order: input order must not decide the result.
  const tests = [
    rt("test_c", "/repo/ccc_test.py", 2),
    rt("test_b", "/repo/bbb_test.py", 2),
    rt("test_a", "/repo/aaa_test.py", 2),
  ];
  const first = group({ runScope: "file", resolveTarget: targets(table).resolve, tests });
  assert.deepStrictEqual(
    first.groups.map((g) => g.placement.targetPath),
    ["/repo/aaa_test.py", "/repo/bbb_test.py", "/repo/ccc_test.py"],
    "all three tie at distance 2; the key makes the order total",
  );
  assert.deepStrictEqual(
    first.groups.map((g) => g.key),
    [...first.groups.map((g) => g.key)].sort(),
    "the tiebreak is the key ascending",
  );
  const again = group({ runScope: "file", resolveTarget: targets(table).resolve, tests: [...tests].reverse() });
  assert.deepStrictEqual(
    again.groups.map((g) => g.key),
    first.groups.map((g) => g.key),
    "reversing the input must not reorder the groups",
  );
});

// --- rule 5: member order by distance then filter ---------------------------

test("tests inside a group are ordered by distance, then by filter [A2 §3 rule 5]", () => {
  const t = targets({
    "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" },
    "/repo/src/b.rs": { targetPath: "/repo/src/b.rs", runRoot: "/repo" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [
      rt("zulu", "/repo/src/a.rs", 2),
      rt("alpha", "/repo/src/b.rs", 2),
      rt("mike", "/repo/src/a.rs", 2),
      rt("yankee", "/repo/src/b.rs", 1),
      rt("bravo", "/repo/src/a.rs", 1),
    ],
  });
  assert.strictEqual(res.groups.length, 1);
  assert.deepStrictEqual(filtersOf(res.groups[0]), ["bravo", "yankee", "alpha", "mike", "zulu"]);
  assert.deepStrictEqual(res.groups[0].tests.map((x) => x.distance), [1, 1, 2, 2, 2]);
});

// --- rule 6: resolveTarget once per DISTINCT file ---------------------------

test("resolveTarget is called ONCE PER DISTINCT FILE: 5 tests in 2 files is exactly 2 calls [A2 §3 rule 6]", () => {
  const t = targets({
    "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" },
    "/repo/src/b.rs": { targetPath: "/repo/src/b.rs", runRoot: "/repo" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [
      rt("t1", "/repo/src/a.rs", 1),
      rt("t2", "/repo/src/b.rs", 1),
      rt("t3", "/repo/src/a.rs", 2),
      rt("t4", "/repo/src/a.rs", 3),
      rt("t5", "/repo/src/b.rs", 4),
    ],
  });
  assert.strictEqual(t.calls.length, 2, "a placement resolution walks the filesystem; five would be four too many");
  assert.deepStrictEqual([...t.calls].sort(), ["/repo/src/a.rs", "/repo/src/b.rs"]);
  assert.strictEqual(res.groups[0].tests.length, 5);
});

test("a REFUSING file is also resolved only once, however many tests it holds [A2 §3 rule 6 + 7]", () => {
  const t = targets({
    "/repo/src/bad.rs": { refuse: "no Cargo.toml above this file" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [rt("t1", "/repo/src/bad.rs", 1), rt("t2", "/repo/src/bad.rs", 2), rt("t3", "/repo/src/bad.rs", 3)],
  });
  assert.deepStrictEqual(t.calls, ["/repo/src/bad.rs"]);
  assert.strictEqual(res.unrunnable.length, 3);
});

// --- rule 7: a refusal is reported, never dropped ---------------------------

test("a refusal puts EVERY test in that file into unrunnable with the reason, and emits no group [A2 §3 rule 7]", () => {
  const t = targets({
    "/repo/src/ok.rs": { targetPath: "/repo/src/ok.rs", runRoot: "/repo" },
    "/repo/src/orphan.rs": { refuse: "this file is not inside a crate" },
  });
  const res = group({
    runScope: "root",
    resolveTarget: t.resolve,
    tests: [
      rt("good_one", "/repo/src/ok.rs", 1),
      rt("orphan_a", "/repo/src/orphan.rs", 1),
      rt("orphan_b", "/repo/src/orphan.rs", 2),
    ],
  });
  assert.deepStrictEqual(allGroupedFilters(res), ["good_one"], "the refused file contributes to no group");
  assert.strictEqual(res.unrunnable.length, 2, "reported, never dropped");
  const byFilter = new Map(res.unrunnable.map((u) => [u.test.filter, u]));
  for (const name of ["orphan_a", "orphan_b"]) {
    assert.ok(byFilter.has(name), `${name} is reported`);
    assert.strictEqual(byFilter.get(name).reason, "this file is not inside a crate", "the reason travels with it");
    assert.strictEqual(byFilter.get(name).test.filePath, "/repo/src/orphan.rs");
  }
});

test("every file refusing gives no groups at all and loses nothing [A2 §3 rules 2 + 7]", () => {
  const t = targets({});
  const res = group({
    runScope: "file",
    resolveTarget: t.resolve,
    tests: [rt("a", "/x/a.py", 1), rt("b", "/y/b.py", 2)],
  });
  assert.deepStrictEqual(res.groups, []);
  assert.deepStrictEqual(res.unrunnable.map((u) => u.test.filter).sort(), ["a", "b"]);
  assert.ok(res.unrunnable.every((u) => typeof u.reason === "string" && u.reason.length > 0));
});

// --- rule 8: purity ---------------------------------------------------------

test("groupTestRuns is pure: a DEEP-FROZEN input neither throws nor changes [A2 §3 rule 8]", () => {
  const tests = [
    rt("zulu", "/repo/src/a.rs", 3, ["zulu", "mid", "inner", "target"]),
    rt("zulu", "/repo/src/a.rs", 1, ["zulu", "target"]),
    rt("alpha", "/repo/src/b.rs", 2, ["alpha", "mid", "target"]),
    rt("orphan", "/repo/src/bad.rs", 1, ["orphan", "target"]),
  ];
  const before = JSON.parse(JSON.stringify(tests));
  const t = targets({
    "/repo/src/a.rs": { targetPath: "/repo/src/a.rs", runRoot: "/repo" },
    "/repo/src/b.rs": { targetPath: "/repo/src/b.rs", runRoot: "/repo" },
    "/repo/src/bad.rs": { refuse: "outside any crate" },
  });
  const input = deepFreeze({ tests, runScope: "root", resolveTarget: t.resolve });
  let res;
  assert.doesNotThrow(() => {
    res = groupTestRuns(input);
  }, "sorting or deduping IN PLACE throws on a frozen array; that is the point");
  assertNoEmptyGroup(res, "purity");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(tests)), before, "the input arrays and objects are untouched");
  assert.strictEqual(tests.length, 4);
  // And it still did the work.
  assert.strictEqual(res.groups.length, 1);
  assert.deepStrictEqual(filtersOf(res.groups[0]), ["zulu", "alpha"]);
  assert.strictEqual(res.unrunnable.length, 1);
});

test("groupTestRuns is deterministic: the same input twice is byte-identical [A2 §3 rule 8]", () => {
  const table = {
    "/repo/a.py": { targetPath: "/repo/a.py", runRoot: "/repo" },
    "/repo/b.py": { targetPath: "/repo/b.py", runRoot: "/repo" },
    "/repo/c.py": { refuse: "no pytest config above this file" },
  };
  const tests = [rt("t_b", "/repo/b.py", 2), rt("t_a", "/repo/a.py", 2), rt("t_c", "/repo/c.py", 1)];
  const one = group({ runScope: "file", resolveTarget: targets(table).resolve, tests });
  const two = group({ runScope: "file", resolveTarget: targets(table).resolve, tests });
  assert.deepStrictEqual(two, one);
  assert.strictEqual(JSON.stringify(two), JSON.stringify(one));
});

// ===========================================================================
// discoverCoveringTests — contract §4
// ===========================================================================

const BOUNDS = { R_MAX: 150, N_MAX: 400, D_MAX: 8 };

const cnode = (name, filePath, line = 0, nameLine = 1) => ({
  name,
  filePath,
  line,
  nameLine,
  handle: name,
});

/** A caller graph keyed by node name. `files` maps filePath -> lines. */
function graph(edges, files) {
  const calls = [];
  return {
    calls,
    resolveCallers: async (n) => {
      calls.push(n.name);
      return edges[n.name] ?? [];
    },
    readLines: (filePath) => files[filePath],
  };
}

// A Rust test file holding two tests. The `#[test]` sits INSIDE the item's
// declaration range for a documented item, which is why the classifier's window
// runs down to the name line (phase A1).
const A_TEST_RS = [
  "#[test]",
  "fn test_alpha() {",
  "}",
  "#[test]",
  "fn test_beta() {",
  "}",
];
const B_TEST_RS = ["#[test]", "fn test_gamma() {", "}"];
const IGNORED_RS = ["#[test]", "#[ignore] // needs a live database", "fn test_slow() {", "}"];
const ANON_RS = ["#[test]", "fn () {", "}"];
const PLAIN = (fn) => [`fn ${fn}() {`, "}"];

const FILES = {
  "/repo/src/target.rs": PLAIN("target"),
  "/repo/src/mid.rs": PLAIN("mid"),
  "/repo/src/inner.rs": PLAIN("inner"),
  "/repo/tests/a_test.rs": A_TEST_RS,
  "/repo/tests/b_test.rs": B_TEST_RS,
};

const TARGET = cnode("target", "/repo/src/target.rs", 0, 0);
const ALPHA = cnode("test_alpha", "/repo/tests/a_test.rs", 0, 1);
const BETA = cnode("test_beta", "/repo/tests/a_test.rs", 3, 4);
const GAMMA = cnode("test_gamma", "/repo/tests/b_test.rs", 0, 1);
const MID = cnode("mid", "/repo/src/mid.rs", 0, 0);
const INNER = cnode("inner", "/repo/src/inner.rs", 0, 0);

// target <- test_alpha, mid ; mid <- test_gamma, inner ; inner <- test_beta
const HAPPY_EDGES = {
  target: [ALPHA, MID],
  mid: [GAMMA, INNER],
  inner: [BETA],
};

const ROOT_TARGETS = {
  "/repo/tests/a_test.rs": { targetPath: "/repo/tests/a_test.rs", runRoot: "/repo" },
  "/repo/tests/b_test.rs": { targetPath: "/repo/tests/b_test.rs", runRoot: "/repo" },
  "/repo/tests/ign_test.rs": { targetPath: "/repo/tests/ign_test.rs", runRoot: "/repo" },
  "/repo/tests/anon_test.rs": { targetPath: "/repo/tests/anon_test.rs", runRoot: "/repo" },
};

function discoverInput(over = {}) {
  const g = graph(over.edges ?? HAPPY_EDGES, over.files ?? FILES);
  const t = targets(over.table ?? ROOT_TARGETS);
  return {
    probe: { graph: g, targets: t },
    input: {
      target: over.target ?? TARGET,
      lang: over.lang ?? "rust",
      resolveCallers: g.resolveCallers,
      readLines: g.readLines,
      inScope: over.inScope ?? (() => true),
      bounds: { ...BOUNDS, ...(over.bounds ?? {}) },
      runScope: over.runScope ?? "root",
      resolveTarget: t.resolve,
      signal: over.signal,
      hangGuardMs: over.hangGuardMs,
    },
  };
}

async function discover(over = {}) {
  const { probe, input } = discoverInput(over);
  const report = await discoverCoveringTests(input);
  assertNoEmptyGroup(report, "discoverCoveringTests");
  return { report, ...probe };
}

test("happy path: tests at distance 1, 2 and 3 are discovered in order and land in groups [A2 §4 rules 1, 5]", async () => {
  const { report } = await discover();
  assert.deepStrictEqual(
    report.discovered.map((d) => [d.name, d.distance]),
    [
      ["test_alpha", 1],
      ["test_gamma", 2],
      ["test_beta", 3],
    ],
    "distance ascending, then filePath, then name",
  );
  assert.deepStrictEqual(report.discovered[2].path, ["test_beta", "inner", "mid", "target"], "test first, target last");
  assert.ok(report.discovered.every((d) => d.excluded === undefined && d.unrunnable === undefined));

  // runScope root: one crate, one spawn, all three tests inside it.
  assert.strictEqual(report.groups.length, 1);
  assert.deepStrictEqual(filtersOf(report.groups[0]), ["test_alpha", "test_gamma", "test_beta"]);
  assert.strictEqual(report.provenZero, false, "tests were found");
});

test("discovered ordering breaks ties on filePath before name [A2 §4 rule 5]", async () => {
  // Two tests at the SAME distance in different files, fed so that the
  // discovery order is the opposite of the required order.
  const zFile = "/repo/tests/z_test.rs";
  const aFile = "/repo/tests/a_test.rs";
  const zTest = cnode("test_aaa", zFile, 0, 1);
  const aTest = cnode("test_zzz", aFile, 0, 1);
  const { report } = await discover({
    edges: { target: [zTest, aTest] },
    files: {
      "/repo/src/target.rs": PLAIN("target"),
      [zFile]: ["#[test]", "fn test_aaa() {", "}"],
      [aFile]: ["#[test]", "fn test_zzz() {", "}"],
    },
    table: {
      [zFile]: { targetPath: zFile, runRoot: "/repo" },
      [aFile]: { targetPath: aFile, runRoot: "/repo" },
    },
  });
  assert.deepStrictEqual(
    report.discovered.map((d) => [d.filePath, d.name]),
    [[aFile, "test_zzz"], [zFile, "test_aaa"]],
    "filePath outranks name",
  );
});

// --- rule 4: provenZero, the headline ---------------------------------------

test("provenZero is TRUE only when the walk COMPLETED and found nothing [A2 §4 rule 4]", async () => {
  const { report } = await discover({
    edges: { target: [MID], mid: [INNER], inner: [] },
    files: FILES,
  });
  assert.deepStrictEqual(report.discovered, [], "no test in this graph");
  assert.strictEqual(report.walk.stoppedBy, undefined, "the caller graph was exhausted");
  assert.strictEqual(report.provenZero, true, "this is the only licence for 'no test calls this function'");
  assert.deepStrictEqual(report.groups, []);
});

test("provenZero is FALSE when R_MAX cut the walk short and nothing was found [A2 §4 rule 4]", async () => {
  // A plain chain longer than the request cap. Nothing is a test, so the only
  // difference from the case above is the BOUND - and it must flip provenZero.
  const chain = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const edges = { target: [cnode("c1", "/repo/src/c1.rs", 0, 0)] };
  const files = { "/repo/src/target.rs": PLAIN("target") };
  chain.forEach((n, i) => {
    files[`/repo/src/${n}.rs`] = PLAIN(n);
    const next = chain[i + 1];
    edges[n] = next ? [cnode(next, `/repo/src/${next}.rs`, 0, 0)] : [];
  });
  const { report } = await discover({ edges, files, bounds: { R_MAX: 3 } });
  assert.deepStrictEqual(report.discovered, [], "found none");
  assert.strictEqual(report.walk.stoppedBy, "requests", "the request cap cut it");
  assert.strictEqual(
    report.provenZero,
    false,
    "'I found none within the budget' is a different sentence and must never be reported as a zero",
  );
  assert.strictEqual(report.walk.requests, 3, "the cap is a request cap");
});

test("provenZero is FALSE when N_MAX cut the walk short and nothing was found [A2 §4 rule 4]", async () => {
  const p = (n) => cnode(n, `/repo/src/${n}.rs`, 0, 0);
  const files = { "/repo/src/target.rs": PLAIN("target") };
  for (const n of ["p1", "p2", "p3"]) files[`/repo/src/${n}.rs`] = PLAIN(n);
  const { report } = await discover({
    edges: { target: [p("p1"), p("p2"), p("p3")], p1: [], p2: [], p3: [] },
    files,
    bounds: { N_MAX: 2 },
  });
  assert.deepStrictEqual(report.discovered, []);
  assert.strictEqual(report.walk.stoppedBy, "nodes");
  assert.strictEqual(report.provenZero, false);
});

test("provenZero is FALSE when D_MAX cut the walk short and nothing was found [A2 §4 rule 4]", async () => {
  const chain = ["d1", "d2", "d3", "d4"];
  const edges = { target: [cnode("d1", "/repo/src/d1.rs", 0, 0)] };
  const files = { "/repo/src/target.rs": PLAIN("target") };
  chain.forEach((n, i) => {
    files[`/repo/src/${n}.rs`] = PLAIN(n);
    const next = chain[i + 1];
    edges[n] = next ? [cnode(next, `/repo/src/${next}.rs`, 0, 0)] : [];
  });
  const { report } = await discover({ edges, files, bounds: { D_MAX: 2 } });
  assert.deepStrictEqual(report.discovered, []);
  assert.strictEqual(report.walk.stoppedBy, "depth", "a node at D_MAX had its callers left unasked");
  assert.strictEqual(report.provenZero, false);
});

test("provenZero is FALSE when the walk was CANCELLED before it found anything [A2 §4 rule 4]", async () => {
  const { report } = await discover({ signal: { aborted: true } });
  assert.deepStrictEqual(report.discovered, []);
  assert.strictEqual(report.walk.stoppedBy, "cancelled");
  assert.strictEqual(report.walk.requests, 0);
  assert.strictEqual(report.provenZero, false, "a cancelled walk proves nothing");
});

test("provenZero is FALSE when the only test found is EXCLUDED: discovered is not empty [A2 §4 rules 2, 4]", async () => {
  const ign = cnode("test_slow", "/repo/tests/ign_test.rs", 0, 2);
  const { report } = await discover({
    edges: { target: [ign] },
    files: { "/repo/src/target.rs": PLAIN("target"), "/repo/tests/ign_test.rs": IGNORED_RS },
  });
  assert.strictEqual(report.discovered.length, 1);
  assert.strictEqual(report.walk.stoppedBy, undefined);
  assert.strictEqual(report.provenZero, false, "provenZero reads discovered, not the groups");
  assert.deepStrictEqual(report.groups, [], "and the excluded test still runs nowhere");
});

// --- rule 2: exclusion ------------------------------------------------------

test("an EXCLUDED test is in discovered carrying its reason and in NO group [A2 §4 rule 2]", async () => {
  const ign = cnode("test_slow", "/repo/tests/ign_test.rs", 0, 2);
  const { report } = await discover({
    edges: { target: [ALPHA, ign] },
    files: { ...FILES, "/repo/tests/ign_test.rs": IGNORED_RS },
  });
  assert.deepStrictEqual(report.discovered.map((d) => d.name).sort(), ["test_alpha", "test_slow"]);
  const slow = report.discovered.find((d) => d.name === "test_slow");
  assert.ok(slow.excluded, "the #[ignore] must reach the surface, not vanish");
  // CONTRACT GAP: the A2 contract types this as phase A1's `Exclusion` without
  // restating its fields, so only its presence and its marker are asserted.
  assert.strictEqual(typeof slow.excluded, "object");
  assert.match(JSON.stringify(slow.excluded), /ignore/i, "the marker names what excluded it");

  const grouped = allGroupedFilters(report);
  assert.deepStrictEqual(grouped, ["test_alpha"], "an excluded test must never be spawned");
  assert.ok(report.discovered.find((d) => d.name === "test_alpha").excluded === undefined);
});

// --- rule 3: unrunnable -----------------------------------------------------

test("a name that cannot become a runner filter is reported unrunnable, never silently dropped [A2 §4 rule 3]", async () => {
  const anon = cnode("", "/repo/tests/anon_test.rs", 0, 1);
  const { report } = await discover({
    edges: { target: [ALPHA, anon] },
    files: { ...FILES, "/repo/tests/anon_test.rs": ANON_RS },
  });
  const nameless = report.discovered.find((d) => d.name === "");
  assert.ok(nameless, "the test is still DISCOVERED");
  assert.strictEqual(
    nameless.unrunnable,
    "the server's name for this test cannot become a runner filter",
    "the contract fixes this wording",
  );
  assert.strictEqual(nameless.excluded, undefined);
  assert.deepStrictEqual(allGroupedFilters(report), ["test_alpha"], "it is in no group");
});

test("a test whose FILE has no run target is reported unrunnable with the resolver's reason [A2 §4 rule 3 + §3 rule 7]", async () => {
  const { report } = await discover({
    table: {
      "/repo/tests/a_test.rs": { targetPath: "/repo/tests/a_test.rs", runRoot: "/repo" },
      "/repo/tests/b_test.rs": { refuse: "no Cargo.toml above this file" },
    },
  });
  const gamma = report.discovered.find((d) => d.name === "test_gamma");
  assert.ok(gamma, "still discovered");
  assert.strictEqual(gamma.unrunnable, "no Cargo.toml above this file", "the refusal reason travels to the surface");
  const grouped = allGroupedFilters(report);
  assert.ok(!grouped.includes("test_gamma"));
  assert.deepStrictEqual(grouped.sort(), ["test_alpha", "test_beta"]);
});

// --- the walk's accounting, verbatim ----------------------------------------

test("the walk's accounting is passed through VERBATIM in `walk` [A2 §4 report shape]", async () => {
  const outside = cnode("bench_helper", "/other/crate/b.rs", 0, 0);
  const boom = cnode("boom", "/repo/src/boom.rs", 0, 0);
  const files = { ...FILES, "/repo/src/boom.rs": PLAIN("boom"), "/other/crate/b.rs": PLAIN("bench_helper") };
  const g = graph(
    {
      target: [ALPHA, MID, outside, boom],
      mid: [GAMMA],
      boom: null, // sentinel: the fake rejects below
    },
    files,
  );
  const failing = g.resolveCallers;
  const t = targets(ROOT_TARGETS);
  const report = await discoverCoveringTests({
    target: TARGET,
    lang: "rust",
    resolveCallers: async (n) => {
      if (n.name === "boom") {
        await failing(n); // still ledgered
        throw new Error("the server gave up");
      }
      return failing(n);
    },
    readLines: g.readLines,
    inScope: (n) => n.filePath.startsWith("/repo/"),
    bounds: BOUNDS,
    runScope: "root",
    resolveTarget: t.resolve,
  });
  assertNoEmptyGroup(report, "accounting");

  assert.strictEqual(report.walk.requests, g.calls.length, "requests is the real call count");
  assert.deepStrictEqual(g.calls, ["target", "mid", "boom"], "a test is a leaf and an out-of-scope node is not walked");
  assert.strictEqual(report.walk.failedRequests, 1, "a rejecting resolveCallers is survivable and counted");
  assert.strictEqual(report.walk.outOfScope, 1);
  assert.strictEqual(report.walk.nodesAdmitted, 4, "test_alpha, mid, boom, test_gamma; the target is not admitted");
  assert.strictEqual(report.walk.depthReached, 2);
  assert.strictEqual(report.walk.stoppedBy, undefined);
  assert.strictEqual(report.walk.tests.length, 2, "the walk's own test list is carried, not rebuilt");
  assert.deepStrictEqual(report.walk.tests.map((x) => x.node.name), ["test_alpha", "test_gamma"]);
  assert.deepStrictEqual(report.discovered.map((d) => d.name), ["test_alpha", "test_gamma"]);
});

test("readLines returning undefined for an unreadable file does not throw or invent a test [A2 §4 rule 1]", async () => {
  const { report } = await discover({
    edges: { target: [ALPHA] },
    files: { "/repo/src/target.rs": PLAIN("target") }, // a_test.rs is unreadable
  });
  // CONTRACT GAP: phase A1 rules an attribute language back to "plain" when the
  // lines are undefined, so an unreadable Rust file yields no test; the reading
  // asserted here is only that it is a completed, empty, non-throwing walk.
  assert.deepStrictEqual(report.discovered, []);
  assert.strictEqual(report.provenZero, true);
});

// --- rule 6: determinism ----------------------------------------------------

test("discoverCoveringTests is deterministic: two runs are byte-identical [A2 §4 rule 6]", async () => {
  const first = (await discover()).report;
  const second = (await discover()).report;
  assert.deepStrictEqual(second, first);
  assert.strictEqual(JSON.stringify(second), JSON.stringify(first), "same graph and same readers, same report");
});

test("determinism holds for the mixed report: excluded, unrunnable and grouped together [A2 §4 rule 6]", async () => {
  const ign = cnode("test_slow", "/repo/tests/ign_test.rs", 0, 2);
  const anon = cnode("", "/repo/tests/anon_test.rs", 0, 1);
  const over = {
    edges: { target: [ALPHA, MID, ign, anon], mid: [GAMMA, INNER], inner: [BETA] },
    files: { ...FILES, "/repo/tests/ign_test.rs": IGNORED_RS, "/repo/tests/anon_test.rs": ANON_RS },
    runScope: "file",
  };
  const a = (await discover(over)).report;
  const b = (await discover(over)).report;
  assert.strictEqual(JSON.stringify(b), JSON.stringify(a));
  // And the mixed report keeps every discovered test while grouping only the runnable ones.
  assert.strictEqual(a.discovered.length, 5, "alpha, slow, the nameless one, gamma, beta");
  assert.deepStrictEqual(
    allGroupedFilters(a).sort(),
    ["test_alpha", "test_beta", "test_gamma"],
    "runScope file still groups only what may run",
  );
  assert.strictEqual(a.groups.length, 2, "a_test.rs and b_test.rs, one spawn each");
});
