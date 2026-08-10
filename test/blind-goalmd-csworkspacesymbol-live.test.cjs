// Blind oracle (LIVE) for goal.md Fix-2's RESOLUTION leg: a bare C# type NAME,
// named only in a doc-comment and DEFINED in a different project, must resolve
// its real member surface through a NEW workspace-symbol capability on the C#
// headless transport (CsLspExtractor).
//
// The gap (goal.md, brief-p3live.md): round-1 pre-fill picks the collaborator
// `Stripe` but cannot RESOLVE it — `Stripe` lives in project Atlas, is named
// only in the `StripeFanout` doc of Playground/Fns.cs, and has no in-span or
// same-file cursor. The pure `csFindTypeReference` returns undefined and the
// candidate is dropped. This drives the fix directly against the REAL Roslyn LS
// over the REAL csharp-scratch fixture (Playground -> Atlas cross-project): ask
// the extractor to resolve `Stripe` BY NAME, then read its members.
//
// Black-box contract (assert the resolved member SET, never internals):
//   resolveTypeCursorByName("Stripe") -> a def cursor in Atlas.cs, whose
//   membersOfType carries Stripe's real public surface — EnrollTile,
//   AggregateFanout, PartitionByLod, TileTally, Summarize — and NONE of the
//   same-file sibling methods (StripeFanout/CohortSeven) or other types'
//   members. The GUARDRAIL is proven too: a fuzzy query for "Stripe" also
//   returns StripeSummary / StripeFanout / StripeMutatorSite, so exact-name +
//   type-kind selection is load-bearing; and resolving a NON-type name
//   ("StripeFanout", a method) yields undefined, never a wrong-type surface.
//
// RED before implementation: resolveTypeCursorByName does not exist yet, so the
// capability call throws / returns undefined and the member assertions fail.
//
// Gated: registered in package.json test:live only. Cold init ~12s; allow
// generous timeouts. Needs the csharp-scratch fixture and the Roslyn LS DLL.
// Run: node --test --test-concurrency=1 test/blind-goalmd-csworkspacesymbol-live.test.cjs

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
    "blind-goalmd-csws",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n` +
      `export { resolveCrossFileShape, csShapeHooks } from "../src/core/crossFileShape";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csws.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csws.bundle.cjs"), { force: true });
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
// references Atlas cross-project; workspace/symbol only indexes loaded
// projects, so Atlas must be opened for `Stripe` to be reachable). Restored once.
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

const names = (ms) => ms.map((m) => m.name);
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

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  cleanup();
});

// ===========================================================================
// The resolution leg: a doc-only, cross-project bare NAME -> its real surface.
// ===========================================================================

gtest("live: resolveTypeCursorByName('Stripe') resolves the cross-project def cursor in Atlas.cs [surface: brief-p3live 'workspace/symbol -> the type definition location']", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "the doc-only, cross-project type `Stripe` resolves BY NAME (no in-span/same-file cursor needed)");
  assert.ok(
    typeof cursor.uri === "string" && fileURLToPath(cursor.uri).endsWith(path.join("Atlas", "Atlas.cs")),
    `the def cursor lands in the Atlas project's Atlas.cs (cross-project), got ${JSON.stringify(cursor.uri)}`
  );
  assert.ok(typeof cursor.line === "number" && typeof cursor.character === "number", "the cursor carries real LSP coordinates");
});

gtest("live: the resolved Stripe cursor's membersOfType is Stripe's REAL public surface, not a sibling/other type [surface: brief-p3live 'resolve its member surface via membersOfType']", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "Stripe resolves by name");
  const members = await ex.membersOfType(cursor);
  const got = new Set(names(members));

  // The real public surface of Atlas.Stripe (brief-p3live oracle fixture).
  for (const m of ["EnrollTile", "AggregateFanout", "PartitionByLod", "TileTally", "Summarize"]) {
    assert.ok(got.has(m), `Stripe's real member \`${m}\` is present, got ${JSON.stringify([...got])}`);
  }
  // NOT the enclosing-class siblings the OLD bug resolved (Fns's own methods),
  // and NOT another type's members: exact-name selection landed on Stripe.
  for (const wrong of ["StripeFanout", "CohortSeven", "Induct", "TallyCohort", "BandsTouched"]) {
    assert.ok(!got.has(wrong), `\`${wrong}\` (a sibling/other-type member) must NOT be in Stripe's surface, got ${JSON.stringify([...got])}`);
  }

  // The surface is SIGNATURE-bearing, not names-only: the pre-fill's csShapeBlock
  // drops any member with no rendered signature, so a names-only resolution would
  // inject an EMPTY block and the fix would be inert. Prove a real signature came
  // back for a resolved method.
  const enroll = members.find((m) => m.name === "EnrollTile");
  assert.ok(enroll && typeof enroll.signature === "string" && enroll.signature.length > 0,
    `the resolved surface carries member signatures (not names only), got ${JSON.stringify(enroll)}`);
});

gtest("live GUARDRAIL: a NON-type name that fuzzy-matches (a method 'StripeFanout') resolves to undefined, never a wrong-type surface [surface: brief-p3live 'exact-name + type-kind selection']", async () => {
  const ex = await extractor();
  // `StripeFanout` is a METHOD (workspace/symbol returns it for the "Stripe"
  // query too). Exact-name + type-kind selection must reject it: there is no
  // TYPE named StripeFanout, so resolution is undefined — not the enclosing
  // Fns class, not Stripe.
  const cursor = await ex.resolveTypeCursorByName("StripeFanout");
  assert.strictEqual(cursor, undefined, "a non-type name resolves to no type cursor");
});

// review-p3live Finding 3: the pre-fill consumer does NOT call membersOfType on
// the by-name cursor directly — it feeds the cursor into resolveCrossFileShape,
// which first runs identifierAt(defText) + definition(cursor) before reading
// members. The other tests prove the cursor + membersOfType; this proves the
// WHOLE consumer path the product actually runs, so a future Roslyn change to
// the by-name cursor shape cannot silently break pre-fill behind a green oracle.
gtest("live WIRING: the by-name cursor drives resolveCrossFileShape end-to-end to Stripe's real surface [surface: review-p3live Finding 3 — the real consumer path]", async () => {
  const ex = await extractor();
  const cursor = await resolveWithSettle(ex, "Stripe");
  assert.ok(cursor, "Stripe resolves by name");
  const openFile = async (uri) => {
    try {
      return fs.readFileSync(fileURLToPath(uri), "utf8");
    } catch {
      return undefined;
    }
  };
  // The same call resolvePrefill makes: the C# cross-file bound + csShapeHooks.
  const shape = await resolveCrossFileShape(ex, cursor, { D_MAX: 3, N_MAX: 16 }, openFile, csShapeHooks);
  const derived = shape.types.get("Stripe");
  assert.ok(derived, `resolveCrossFileShape derives the Stripe type from the by-name cursor, got ${JSON.stringify([...shape.types.keys()])}`);
  // derived.methods is a rendered signature string[] (renderMethods), so match on
  // the method name appearing in a rendered line — the same surface csShapeBlock
  // injects into the prompt.
  const rendered = derived.methods.join("\n");
  for (const m of ["EnrollTile", "AggregateFanout", "PartitionByLod"]) {
    assert.ok(rendered.includes(m), `the full consumer path carries Stripe's method \`${m}\`, got ${JSON.stringify(derived.methods)}`);
  }
});
