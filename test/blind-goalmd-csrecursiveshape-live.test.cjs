// Blind oracle (LIVE) for goal.md Goal-2 Fix-3: RECURSIVE collaborator-graph
// shapes for C#. Today C# cross-file shape resolution is FLAT — csShapeHooks
// yields no fields, so the walk never recurses and resolving `Stripe` carries
// ONLY Stripe's own one-level member signatures. A LINQ/fluent chain
// (`stripe.PartitionByLod().Values.SelectMany(l => l).Sum(t => t.SubtendedChildren())`)
// needs `Tile`'s members too, and the fact that `PartitionByLod()` returns
// `IReadOnlyDictionary<int, List<Tile>>`. Injection names `Tile` in Stripe's
// return types but never resolves its shape, so the nested member is
// hallucinated.
//
// The fix (a DIFFERENT traversal than Rust's field recursion): recurse the user
// types named in a resolved type's member SIGNATURES (return/param/property
// types), anchored cross-project by the extractor's resolveTypeCursorByName,
// bounded by the SAME D_MAX/N_MAX, deduped via `visited`.
//
// Black-box contract (assert the derived type GRAPH, never internals), driven
// against the REAL Roslyn LS over the REAL csharp-scratch fixture:
//   resolveCrossFileShape(Stripe-cursor, csShapeHooks) yields a graph that
//   ALSO carries `Tile` (a depth-1 signature-referenced type) WITH Tile's real
//   public surface — SubtendedChildren, Encloses, MortonCode, Lod, Band — plus
//   `StripeSummary` (Summarize's return) and, one hop deeper, `LodBand`. It is
//   BOUNDED: it does not pull unrelated types (Cartography), it stays within
//   N_MAX, and a tight N_MAX caps it with the excluded types NAMED in `dropped`
//   (never silent-truncated). D_MAX=1 emits ONLY the depth-1 signature edges
//   (Tile, StripeSummary) and NOT the depth-2 LodBand — proving the traversal is
//   the signature-edge graph, depth-bounded.
//
// RED before implementation: C# shape resolution is flat, so the shape is just
// { Stripe } and every Tile/StripeSummary/LodBand assertion fails.
//
// Gated: registered in package.json test:live only. Cold init ~12s; allow
// generous timeouts. Needs the csharp-scratch fixture and the Roslyn LS DLL.
// Run: node --test --test-concurrency=1 test/blind-goalmd-csrecursiveshape-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"
);
const REPO = "/home/utilitydelta/repos/csharp-scratch";
const PLAYGROUND_CSPROJ = path.join(REPO, "src/Playground/Playground.csproj");
const ATLAS_CSPROJ = path.join(REPO, "src/Atlas/Atlas.csproj");
const ATLAS_CS = path.join(REPO, "src/Atlas/Atlas.cs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-goalmd-csrec",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n` +
      `export { resolveCrossFileShape, csShapeHooks } from "../src/core/crossFileShape";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csrec.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csrec.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.CsLspExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no CsLspExtractor class");
}
const { CsLspExtractor, resolveCrossFileShape, csShapeHooks } = mod;

const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;
const fixtureMissing = !fs.existsSync(ATLAS_CS)
  ? `csharp-scratch fixture not found at ${REPO}`
  : undefined;

test("bundle: the C# headless transport builds (CsLspExtractor exported) [surface: 'csLspExtractor.ts']", () => {
  if (bundleError) assert.fail(`the C# headless transport did not bundle: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, async (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (dllMissing) return ctx.skip(dllMissing);
    if (fixtureMissing) return ctx.skip(fixtureMissing);
    return fn(ctx);
  });

// One shared extractor over the real fixture: BOTH projects loaded (Playground
// references Atlas cross-project; workspace/symbol only indexes loaded projects,
// so Atlas must be opened for `Stripe` and its collaborators to be reachable).
let exP;
let restored = false;
const extractor = () =>
  (exP ||= (async () => {
    if (!restored) {
      execFileSync("dotnet", ["restore", PLAYGROUND_CSPROJ], { cwd: REPO, timeout: 180000, stdio: "ignore" });
      restored = true;
    }
    const ex = await CsLspExtractor.start({
      projectRoot: REPO,
      csproj: [pathToFileURL(PLAYGROUND_CSPROJ).href, pathToFileURL(ATLAS_CSPROJ).href],
      serverDll: ROSLYN_DLL,
    });
    await ex.whenReady();
    return ex;
  })());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// workspace/symbol can lag a freshly initialized project by a few hundred ms;
// bounded retries absorb the index race without masking a genuine miss.
async function resolveWithSettle(ex, name) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cursor = await ex.resolveTypeCursorByName(name);
    if (cursor) return cursor;
    await sleep(500);
  }
  return undefined;
}

const openFile = async (uri) => {
  try {
    return fs.readFileSync(fileURLToPath(uri), "utf8");
  } catch {
    return undefined;
  }
};

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  cleanup();
});

// ===========================================================================
// The signature-edge recursion: Stripe's collaborator graph, not just Stripe.
// ===========================================================================

gtest("live: resolving Stripe RECURSES on member-signature types — the graph carries Tile WITH its real surface, plus StripeSummary and LodBand [surface: crossFileShape signature-edge recursion]", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "Stripe resolves by name");

  const shape = await resolveCrossFileShape(ex, cursor, { D_MAX: 3, N_MAX: 16 }, openFile, csShapeHooks);
  const keys = [...shape.types.keys()];

  // The root still resolves.
  assert.ok(shape.types.has("Stripe"), `the root Stripe is derived, got ${JSON.stringify(keys)}`);

  // Depth-1 signature-referenced collaborators: Tile (EnrollTile param +
  // PartitionByLod return), StripeSummary (Summarize return).
  assert.ok(shape.types.has("Tile"), `the depth-1 signature-referenced type Tile is now carried, got ${JSON.stringify(keys)}`);
  assert.ok(shape.types.has("StripeSummary"), `Summarize's return type StripeSummary is carried, got ${JSON.stringify(keys)}`);
  // Depth-2 collaborator reached through Tile.Band / StripeSummary.BandsTouched.
  assert.ok(shape.types.has("LodBand"), `the depth-2 type LodBand is carried, got ${JSON.stringify(keys)}`);

  // Tile carries its REAL member surface (the whole point: the LINQ chain needs
  // these). methods is a rendered signature string[]; match on the member name.
  const tile = shape.types.get("Tile");
  const rendered = tile.methods.join("\n");
  for (const m of ["SubtendedChildren", "Encloses", "MortonCode", "Lod", "Band"]) {
    assert.ok(rendered.includes(m), `Tile's real member \`${m}\` is present, got ${JSON.stringify(tile.methods)}`);
  }

  // BOUNDED / selective: it did NOT bulk-inject unrelated project types. The
  // static helper class Cartography is referenced only in DOC prose / method
  // bodies, never a member SIGNATURE, so the signature-edge walk must not pull
  // it — the guardrail against turning this into a using-mining bulk inject.
  assert.ok(!shape.types.has("Cartography"), `an unrelated type Cartography (not signature-referenced) must NOT be pulled, got ${JSON.stringify(keys)}`);
  assert.ok(shape.types.size <= 16, `the graph stays within N_MAX, got ${shape.types.size}: ${JSON.stringify(keys)}`);
  // A tight, exact-ish graph — Stripe + a small handful of collaborators.
  assert.ok(shape.types.size <= 6, `the collaborator graph is a small handful, not an explosion, got ${shape.types.size}: ${JSON.stringify(keys)}`);
});

gtest("live: the recursion is DEPTH-bounded — D_MAX=1 emits ONLY the depth-1 signature edges (Tile, StripeSummary), never the depth-2 LodBand [surface: D_MAX bound on signature edges]", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "Stripe resolves by name");

  const shape = await resolveCrossFileShape(ex, cursor, { D_MAX: 1, N_MAX: 16 }, openFile, csShapeHooks);
  const keys = [...shape.types.keys()];
  assert.ok(shape.types.has("Stripe"), `root present, got ${JSON.stringify(keys)}`);
  assert.ok(shape.types.has("Tile"), `depth-1 Tile present, got ${JSON.stringify(keys)}`);
  assert.ok(shape.types.has("StripeSummary"), `depth-1 StripeSummary present, got ${JSON.stringify(keys)}`);
  // LodBand is a depth-2 edge (Tile.Band / StripeSummary.BandsTouched); D_MAX=1
  // stops expansion at depth 1, so it must NOT be emitted — the depth bound is
  // real, not decorative.
  assert.ok(!shape.types.has("LodBand"), `depth-2 LodBand must be EXCLUDED at D_MAX=1, got ${JSON.stringify(keys)}`);
});

gtest("live GUARDRAIL: a tight N_MAX caps the graph and NAMES the excluded signature types in `dropped` (never silent-truncate) [surface: N_MAX cap + dropped log]", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "Stripe resolves by name");

  // N_MAX=2: Stripe + exactly one collaborator survive; the rest are dropped,
  // and the drop log must NAME them rather than silently vanish.
  const shape = await resolveCrossFileShape(ex, cursor, { D_MAX: 3, N_MAX: 2 }, openFile, csShapeHooks);
  assert.ok(shape.types.size <= 2, `N_MAX=2 caps the emitted graph, got ${shape.types.size}: ${JSON.stringify([...shape.types.keys()])}`);
  assert.ok(shape.types.has("Stripe"), "the root still resolves under the cap");
  // The excluded collaborators are recorded, disjoint from emitted, never silent.
  assert.ok(shape.dropped.length > 0, `capped-out signature types are NAMED in dropped, got ${JSON.stringify(shape.dropped)}`);
  const emitted = new Set(shape.types.keys());
  for (const d of shape.dropped) {
    assert.ok(!emitted.has(d), `dropped names are disjoint from emitted, offender ${d}`);
  }
  // The dropped set names REAL signature collaborators (Tile/StripeSummary/LodBand),
  // not garbage.
  assert.ok(
    ["Tile", "StripeSummary", "LodBand"].some((t) => shape.dropped.includes(t)),
    `dropped names the real capped-out collaborators, got ${JSON.stringify(shape.dropped)}`
  );
});
