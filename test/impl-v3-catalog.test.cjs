// Implementer tests for the enabled-optional catalog internals the blind
// contract cannot see: the --filter-platform wiring and host-triple parsing
// (the offline-correctness half), renamed-optional matching by package-id, and
// description-by-id resolution.
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-catalog.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v3-catalog",
  `export { buildCatalog, fetchCatalog, resolveHostTriple, makeHostScopedCatalogFetcher } from "../src/core/catalog";\n`
);
const { buildCatalog, fetchCatalog, resolveHostTriple, makeHostScopedCatalogFetcher } = mod;

// ---------------------------------------------------------------------------
// SESSION-V55 PHASE 22, queue Q4: the fetcher memoizes per crate root and
// invalidates on the MANIFEST.
//
// Before this, every unresolved-crate accept re-spawned `cargo metadata` for
// the same unchanged project. The catalog is steering payload for a
// hallucinated crate name, so a developer hitting that error twice in a row
// paid for the same answer twice.
//
// The stamp is injected rather than read off disk: the contract is about WHEN
// the answer may change, and a row that had to touch a real file to say so
// would be coupled to filesystem mtime granularity.
// ---------------------------------------------------------------------------

const METADATA = JSON.stringify({
  packages: [
    { id: "root 1.0.0", name: "root", version: "1.0.0", description: null, dependencies: [{ name: "serde", kind: null, optional: false } ] },
    { id: "serde 1.0.0", name: "serde", version: "1.0.0", description: "A serialization framework", dependencies: [] },
  ],
  workspace_members: ["root 1.0.0"],
  resolve: { nodes: [{ id: "root 1.0.0", deps: [{ pkg: "serde 1.0.0", name: "serde", dep_kinds: [{ kind: null }] }] }], root: "root 1.0.0" },
});

const countingRun = () => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd.args.join(" "));
    if (cmd.args[0] === "-vV" || cmd.args.includes("-vV")) {
      return { exitCode: 0, stdout: "rustc 1.0.0\nhost: x86_64-unknown-linux-gnu\n", stderr: "" };
    }
    return { exitCode: 0, stdout: METADATA, stderr: "" };
  };
  return { calls, run, metadataCalls: () => calls.filter((a) => a.startsWith("metadata")).length };
};

test("Q4: two accepts on an unchanged crate root spawn `cargo metadata` ONCE", async () => {
  const { run, metadataCalls } = countingRun();
  const fetcher = makeHostScopedCatalogFetcher(run, () => "size:mtime");
  const first = await fetcher("/crate");
  const second = await fetcher("/crate");
  assert.ok(first.length > 0, `precondition: the fixture must produce a real catalog, got ${JSON.stringify(first)}`);
  assert.deepEqual(second, first, "and the second accept must get the same answer");
  assert.equal(metadataCalls(), 1, "the second accept must not re-spawn cargo metadata");
});

test("Q4: a TOUCHED Cargo.toml spawns again - the memo is keyed on the manifest, not on time", async () => {
  const { run, metadataCalls } = countingRun();
  let stamp = "size:1";
  const fetcher = makeHostScopedCatalogFetcher(run, () => stamp);
  await fetcher("/crate");
  await fetcher("/crate");
  assert.equal(metadataCalls(), 1, "precondition: unchanged means one spawn");
  stamp = "size:2"; // the developer added a dependency
  await fetcher("/crate");
  assert.equal(metadataCalls(), 2, "a changed manifest must re-spawn, or the catalog steers to a stale dependency set");
});

test("Q4: two crate roots do not share an entry", async () => {
  const { run, metadataCalls } = countingRun();
  const fetcher = makeHostScopedCatalogFetcher(run, () => "same-stamp-both");
  await fetcher("/a");
  await fetcher("/b");
  await fetcher("/a");
  assert.equal(metadataCalls(), 2, "one spawn per root, and /a's second accept is served from its own entry");
});

test("Q4: a manifest that cannot be stat'd is never cached - staleness it cannot know, it does not claim", async () => {
  const { run, metadataCalls } = countingRun();
  const fetcher = makeHostScopedCatalogFetcher(run, () => undefined);
  await fetcher("/crate");
  await fetcher("/crate");
  assert.equal(metadataCalls(), 2, "no stamp means no memo, which is the honest degrade");
});

test("Q4: an EMPTY result is not cached, so a transient cargo failure cannot strand the session", async () => {
  const calls = [];
  let broken = true;
  const run = async (cmd) => {
    calls.push(cmd.args.join(" "));
    if (cmd.args.includes("-vV")) {
      return { exitCode: 0, stdout: "rustc 1.0.0\nhost: x86_64-unknown-linux-gnu\n", stderr: "" };
    }
    return broken ? { exitCode: 101, stdout: "", stderr: "error: could not read manifest" } : { exitCode: 0, stdout: METADATA, stderr: "" };
  };
  const fetcher = makeHostScopedCatalogFetcher(run, () => "unchanged");
  assert.deepEqual(await fetcher("/crate"), [], "precondition: a failed cargo metadata answers with an empty catalog");
  broken = false;
  const second = await fetcher("/crate");
  assert.ok(second.length > 0, "the same root must be retried once cargo works again, not served the cached failure");
  assert.equal(calls.filter((a) => a.startsWith("metadata")).length, 2);
});

test("Q4: two accepts racing a COLD root share one spawn rather than starting two", async () => {
  const { run, metadataCalls } = countingRun();
  const fetcher = makeHostScopedCatalogFetcher(run, () => "stamp");
  const [a, b] = await Promise.all([fetcher("/crate"), fetcher("/crate")]);
  assert.deepEqual(a, b);
  assert.equal(metadataCalls(), 1, "the memo caches the promise, not just the settled value");
});
test.after(cleanup);

// A runCommand seam that records the command it was handed and returns canned output.
const recorder = (stdout, exitCode = 0) => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    return { stdout, exitCode };
  };
  return { run, calls };
};

const META = (extra) =>
  JSON.stringify({
    packages: [{ name: "solo", id: "sid", dependencies: [] }],
    workspace_members: ["sid"],
    ...extra,
  });

test("fetchCatalog passes --filter-platform when a host triple is given", async () => {
  const { run, calls } = recorder(META());
  await fetchCatalog("/crate", run, "x86_64-unknown-linux-gnu");
  assert.deepStrictEqual(calls[0].args, [
    "metadata", "--format-version", "1", "--filter-platform", "x86_64-unknown-linux-gnu",
  ]);
  assert.strictEqual(calls[0].command, "cargo");
  assert.strictEqual(calls[0].cwd, "/crate");
});

test("fetchCatalog omits --filter-platform when no triple is given (the raw seam; production uses the host-scoped fetcher below)", async () => {
  const { run, calls } = recorder(META());
  await fetchCatalog("/crate", run);
  assert.deepStrictEqual(calls[0].args, ["metadata", "--format-version", "1"]);
});

// The production wiring: makeHostScopedCatalogFetcher resolves the host triple
// and scopes every metadata run to it, so a platform-pruned optional can never
// be promoted. This is what fnGen.ts wires in (the CRITICAL the phase-3 review
// caught: the filter machinery existed but was never connected).
test("makeHostScopedCatalogFetcher scopes cargo metadata to the host triple and memoizes the triple", async () => {
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    if (cmd.command === "rustc") {
      return { stdout: "host: x86_64-unknown-linux-gnu\n", exitCode: 0 };
    }
    return { stdout: META(), exitCode: 0 };
  };
  const fetcher = makeHostScopedCatalogFetcher(run);
  await fetcher("/crate-a");
  await fetcher("/crate-b");
  const rustcCalls = calls.filter((c) => c.command === "rustc");
  const cargoCalls = calls.filter((c) => c.command === "cargo");
  assert.strictEqual(rustcCalls.length, 1, "host triple resolved once, then memoized across fetches");
  assert.strictEqual(cargoCalls.length, 2, "one cargo metadata per fetch");
  for (const c of cargoCalls) {
    assert.ok(
      c.args.includes("--filter-platform") && c.args.includes("x86_64-unknown-linux-gnu"),
      "every metadata run is scoped to the host triple",
    );
  }
});

test("makeHostScopedCatalogFetcher still runs (unfiltered) when the host triple cannot be resolved", async () => {
  // rustc fails -> resolveHostTriple undefined -> fetchCatalog without the flag,
  // rather than refusing to build a catalog at all.
  const calls = [];
  const run = async (cmd) => {
    calls.push(cmd);
    if (cmd.command === "rustc") {
      return { stdout: "", exitCode: 1 };
    }
    return { stdout: META(), exitCode: 0 };
  };
  await makeHostScopedCatalogFetcher(run)("/crate");
  const cargo = calls.find((c) => c.command === "cargo");
  assert.deepStrictEqual(cargo.args, ["metadata", "--format-version", "1"]);
});

test("fetchCatalog returns [] on a non-zero cargo exit, never throws", async () => {
  const { run } = recorder("", 101);
  assert.deepStrictEqual(await fetchCatalog("/crate", run, "x"), []);
});

test("resolveHostTriple parses the host line from rustc -vV", async () => {
  const vv = [
    "rustc 1.96.0 (ac68faa20 2026-05-25)",
    "binary: rustc",
    "host: x86_64-unknown-linux-gnu",
    "release: 1.96.0",
  ].join("\n");
  const { run, calls } = recorder(vv);
  assert.strictEqual(await resolveHostTriple(run), "x86_64-unknown-linux-gnu");
  assert.deepStrictEqual(calls[0].args, ["-vV"]);
  assert.strictEqual(calls[0].command, "rustc");
});

test("resolveHostTriple returns undefined on non-zero exit or missing host line", async () => {
  assert.strictEqual(await resolveHostTriple(recorder("host: x", 1).run), undefined);
  assert.strictEqual(await resolveHostTriple(recorder("no host here", 0).run), undefined);
});

// A renamed OPTIONAL dep: manifest name is the package name, rename is the local
// name, the resolve node dep carries the extern name. Matched by package-id.
test("buildCatalog lists a renamed enabled-optional by its resolve-dep import name, matched by package-id", () => {
  const md = {
    packages: [
      {
        name: "member", id: "m",
        dependencies: [{ name: "the-pkg", rename: "local_alias", optional: true, kind: null }],
      },
      { name: "the-pkg", id: "pkg-id", description: "A renamed optional crate." },
    ],
    workspace_members: ["m"],
    resolve: {
      nodes: [{ id: "m", deps: [{ name: "extern_name", pkg: "pkg-id", dep_kinds: [{ kind: null }] }] }],
    },
  };
  const entries = buildCatalog(md);
  // The import name is the resolve dep's `name` (what code writes); description by pkg-id.
  assert.deepStrictEqual(entries.map((e) => e.name), ["extern_name"]);
  assert.match(entries[0].description, /renamed optional crate/i);
});

test("buildCatalog: an optional dep enabled only as a build-dep in the node is excluded", () => {
  const md = {
    packages: [
      { name: "member", id: "m", dependencies: [{ name: "buildonly", optional: true, kind: null }] },
      { name: "buildonly", id: "b-id", description: "Build only." },
    ],
    workspace_members: ["m"],
    resolve: { nodes: [{ id: "m", deps: [{ name: "buildonly", pkg: "b-id", dep_kinds: [{ kind: "build" }] }] }] },
  };
  assert.deepStrictEqual(buildCatalog(md), []);
});
