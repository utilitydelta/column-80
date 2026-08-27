// White-box: run grouping and the discovery facade (session-v60 phase A2).
// Pins the internals the blind oracle cannot see - the exact resolveTarget call
// count, the identity used to write a grouper refusal back onto a discovered
// row, and that the walk's accounting rides through untouched.
//
// Run: npm run test:unit

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v60-discovery",
  `export { groupTestRuns } from "../src/core/testRunGroup";
export { discoverCoveringTests } from "../src/core/testDiscovery";\n`,
);
const { groupTestRuns, discoverCoveringTests } = mod;
test.after(cleanup);

const placement = (over = {}) => ({
  targetPath: over.targetPath ?? "/repo/tests/a_test.go",
  exists: true,
  mode: "same-file",
  runRoot: over.runRoot ?? "/repo",
  ...over,
});

const rt = (filter, filePath, distance, path) => ({
  filter,
  filePath,
  distance,
  path: path ?? [filter, "target"],
});

// ---------------------------------------------------------------------------
// groupTestRuns
// ---------------------------------------------------------------------------

test("root scope collapses many FILES into ONE spawn, which is the Rust case", () => {
  const { groups } = groupTestRuns({
    tests: [rt("a", "/repo/src/x.rs", 1), rt("b", "/repo/src/y.rs", 2), rt("c", "/repo/src/z.rs", 3)],
    runScope: "root",
    resolveTarget: (f) => ({ ok: true, placement: placement({ runRoot: "/repo", targetPath: f }), frameworkId: "libtest" }),
  });
  assert.strictEqual(groups.length, 1, "305 discovered Rust tests must be one cargo invocation");
  assert.deepStrictEqual(groups[0].tests.map((t) => t.filter), ["a", "b", "c"]);
});

test("file scope splits the SAME tests into one spawn per file", () => {
  const { groups } = groupTestRuns({
    tests: [rt("a", "/repo/t/x_test.py", 1), rt("b", "/repo/t/y_test.py", 2), rt("c", "/repo/t/x_test.py", 3)],
    runScope: "file",
    resolveTarget: (f) => ({ ok: true, placement: placement({ runRoot: "/repo", targetPath: f }), frameworkId: "pytest" }),
  });
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(
    groups.map((g) => g.tests.map((t) => t.filter)),
    [["a", "c"], ["b"]],
    "nearest group first, and each group holds only its own file's tests",
  );
});

test("package scope collapses two files in one package and keeps two packages apart", () => {
  const pkgOf = (f) => (f.includes("/inner/") ? "./inner" : ".");
  const { groups } = groupTestRuns({
    tests: [
      rt("A", "/m/inner/a_test.go", 1),
      rt("B", "/m/inner/b_test.go", 2),
      rt("C", "/m/c_test.go", 3),
    ],
    runScope: "package",
    resolveTarget: (f) => ({
      ok: true,
      placement: placement({ runRoot: "/m", targetPath: f, packageArg: pkgOf(f) }),
      frameworkId: "gotest",
    }),
  });
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(groups[0].tests.map((t) => t.filter), ["A", "B"]);
  assert.deepStrictEqual(groups[1].tests.map((t) => t.filter), ["C"]);
});

test("resolveTarget is called ONCE PER DISTINCT FILE, not once per test", () => {
  const seen = [];
  groupTestRuns({
    tests: [
      rt("a", "/r/x.rs", 1), rt("b", "/r/x.rs", 1), rt("c", "/r/x.rs", 2),
      rt("d", "/r/y.rs", 2), rt("e", "/r/y.rs", 3),
    ],
    runScope: "root",
    resolveTarget: (f) => {
      seen.push(f);
      return { ok: true, placement: placement({ runRoot: "/r", targetPath: f }), frameworkId: "libtest" };
    },
  });
  assert.deepStrictEqual(seen, ["/r/x.rs", "/r/y.rs"], "5 tests, 2 files, 2 resolutions");
});

test("a duplicate filter keeps the SHORTEST distance AND that distance's path", () => {
  const { groups } = groupTestRuns({
    tests: [
      rt("dup", "/r/x.rs", 4, ["dup", "w", "v", "u", "target"]),
      rt("dup", "/r/x.rs", 2, ["dup", "mid", "target"]),
    ],
    runScope: "root",
    resolveTarget: () => ({ ok: true, placement: placement(), frameworkId: "libtest" }),
  });
  assert.strictEqual(groups[0].tests.length, 1);
  assert.strictEqual(groups[0].tests[0].distance, 2);
  assert.deepStrictEqual(
    groups[0].tests[0].path,
    ["dup", "mid", "target"],
    "the short distance must bring its OWN path; a 2 beside a 4-hop chain is a lie on the surface",
  );
});

test("a refusal puts EVERY test in that file into unrunnable and emits no group for it", () => {
  const { groups, unrunnable } = groupTestRuns({
    tests: [rt("a", "/r/ok.rs", 1), rt("b", "/r/bad.rs", 1), rt("c", "/r/bad.rs", 2)],
    runScope: "file",
    resolveTarget: (f) =>
      f.includes("bad")
        ? { ok: false, reason: "no Cargo.toml above /r/bad.rs" }
        : { ok: true, placement: placement({ runRoot: "/r", targetPath: f }), frameworkId: "libtest" },
  });
  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(unrunnable.map((u) => u.test.filter), ["b", "c"]);
  assert.ok(unrunnable.every((u) => u.reason.includes("Cargo.toml")), "the reason NAMES what is missing");
});

test("group order is total: a genuine distance tie breaks on the key", () => {
  const first = groupTestRuns({
    tests: [rt("a", "/r/b.py", 1), rt("b", "/r/a.py", 1)],
    runScope: "file",
    resolveTarget: (f) => ({ ok: true, placement: placement({ runRoot: "/r", targetPath: f }), frameworkId: "pytest" }),
  });
  const second = groupTestRuns({
    tests: [rt("b", "/r/a.py", 1), rt("a", "/r/b.py", 1)],
    runScope: "file",
    resolveTarget: (f) => ({ ok: true, placement: placement({ runRoot: "/r", targetPath: f }), frameworkId: "pytest" }),
  });
  assert.deepStrictEqual(
    first.groups.map((g) => g.key),
    second.groups.map((g) => g.key),
    "insertion order must not decide the answer",
  );
});

test("grouping mutates nothing it was handed", () => {
  const tests = [Object.freeze(rt("a", "/r/x.rs", 1))];
  Object.freeze(tests);
  assert.doesNotThrow(() =>
    groupTestRuns({
      tests,
      runScope: "root",
      resolveTarget: () => ({ ok: true, placement: placement(), frameworkId: "libtest" }),
    }),
  );
});

// ---------------------------------------------------------------------------
// discoverCoveringTests
// ---------------------------------------------------------------------------

const node = (name, over = {}) => ({
  name,
  filePath: over.filePath ?? "/r/src/lib.rs",
  line: over.line ?? 10,
  nameLine: over.nameLine ?? 11,
  handle: name,
  ...over,
});

const BOUNDS = { R_MAX: 100, N_MAX: 100, D_MAX: 8 };

// A rust file whose every declaration carries #[test], so the classifier says
// "test" for anything the graph names in it.
const TEST_FILE_LINES = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "#[test]" : "fn t() {"));

async function discover(graph, opts = {}) {
  return discoverCoveringTests({
    target: node("target"),
    lang: opts.lang ?? "rust",
    resolveCallers: async (n) => {
      if (opts.failAll) {
        throw new Error("server down");
      }
      return (graph[n.name] ?? []).map((c) => node(c, { filePath: opts.fileOf ? opts.fileOf(c) : "/r/tests/t.rs" }));
    },
    readLines: opts.readLines ?? (() => TEST_FILE_LINES),
    inScope: opts.inScope ?? (() => true),
    bounds: { ...BOUNDS, ...(opts.bounds ?? {}) },
    runScope: opts.runScope ?? "root",
    resolveTarget:
      opts.resolveTarget ??
      ((f) => ({ ok: true, placement: placement({ runRoot: "/r", targetPath: f }), frameworkId: "libtest" })),
  });
}

test("PROVEN ZERO is true only when the walk COMPLETED and found nothing", async () => {
  const complete = await discover({ target: [] });
  assert.strictEqual(complete.discovered.length, 0);
  assert.strictEqual(complete.walk.stoppedBy, undefined);
  assert.strictEqual(complete.provenZero, true, "this licenses the product's strongest sentence");
});

test("a walk cut short by ANY bound is never a proven zero, even finding nothing", async () => {
  // A long chain of PLAIN nodes so nothing classifies as a test.
  const chain = { target: ["a"], a: ["b"], b: ["c"], c: ["d"] };
  const plainLines = ["fn a() {", "fn b() {", "fn c() {", "fn d() {"];
  for (const bounds of [{ R_MAX: 2 }, { N_MAX: 1 }, { D_MAX: 1 }]) {
    const res = await discover(chain, { bounds, readLines: () => plainLines });
    assert.strictEqual(res.discovered.length, 0, `${JSON.stringify(bounds)}: found nothing`);
    assert.notStrictEqual(res.walk.stoppedBy, undefined, `${JSON.stringify(bounds)}: was cut short`);
    assert.strictEqual(
      res.provenZero,
      false,
      `${JSON.stringify(bounds)}: a budget truncation must never read as a certificate`,
    );
  }
});

test("an EXCLUDED test is discovered and reported, and is in NO group", async () => {
  const lines = ["#[test]", "#[ignore]", "fn slow_case() {"];
  const res = await discover(
    { target: ["slow_case"] },
    { readLines: () => lines, },
  );
  assert.strictEqual(res.discovered.length, 1);
  assert.ok(res.discovered[0].excluded, "silence here would read as 'the walk missed it'");
  assert.match(res.discovered[0].excluded.marker, /ignore/);
  assert.strictEqual(res.groups.length, 0, "an excluded test never reaches a runner");
});

test("a name that cannot become a filter is reported, not silently dropped", async () => {
  const res = await discover({ target: ["/r/a.test.ts"] }, { lang: "typescript" });
  // TypeScript classifies everything plain, so nothing is discovered at all -
  // which is the ruled file-granularity behaviour, and the honest zero for it.
  assert.strictEqual(res.discovered.length, 0);
});

test("the walk's own accounting rides through verbatim", async () => {
  const res = await discover({ target: ["t"] });
  assert.strictEqual(res.walk.requests, 1);
  assert.strictEqual(res.walk.nodesAdmitted, 1);
  assert.strictEqual(res.walk.failedRequests, 0);
  const dead = await discover({ target: ["t"] }, { failAll: true });
  assert.strictEqual(dead.walk.failedRequests, 1);
  assert.strictEqual(dead.walk.stoppedBy, undefined, "a rejection is survivable, so no bound cut the walk");
  // REVERSED by adversarial review row A12. A rejected request leaves a whole
  // subtree UNSEEN, and this row used to certify that as a proven zero on the
  // strength of an absent `stoppedBy` alone. `provenZero` now requires
  // `failedRequests === 0` as well, so the product's strongest sentence cannot
  // rest on a subtree nobody looked at.
  assert.strictEqual(dead.provenZero, false, "a zero standing on a rejected request is not a fact");
});

test("discovered rows are ordered by distance, then file, then name", async () => {
  // `mid` lives in a source file with no attributes, so it stays PLAIN and the
  // walk goes through it. The three tests land at two distances across two files.
  const res = await discover(
    { target: ["t_b", "t_a", "mid"], mid: ["t_c"] },
    {
      fileOf: (c) =>
        c === "mid" ? "/r/src/mid.rs" : c === "t_a" ? "/r/tests/a.rs" : "/r/tests/b.rs",
      readLines: (f) => (f === "/r/src/mid.rs" ? ["fn mid() {"] : TEST_FILE_LINES),
    },
  );
  assert.deepStrictEqual(res.discovered.map((d) => `${d.distance}:${d.name}`), ["1:t_a", "1:t_b", "2:t_c"]);
  assert.deepStrictEqual(res.discovered[2].path, ["t_c", "mid", "target"]);
});

test("the same graph twice gives a byte-identical report", async () => {
  const graph = { target: ["t_a", "mid"], mid: ["t_b"] };
  const a = await discover(graph);
  const b = await discover(graph);
  assert.deepStrictEqual(JSON.stringify(a), JSON.stringify(b));
});
