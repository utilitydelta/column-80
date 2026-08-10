// Blind oracle (LIVE) for goal.md Goal-C: a generated/repaired C# body that
// references a real, reachable, but UNIMPORTED type (CS0246) must get Roslyn's
// AddImport `using X;` code action recognized and its edit routed OUT OF SPAN
// (top of file), the way Python/TS already do — NOT the in-span fully-qualify.
//
// The gap (goal.md, brief-p5.md, verify-p5-codeactions.md): at the `Stripe`
// cursor with no `using Atlas;`, Roslyn offers FOUR quickfixes —
//   "using Atlas;"          (data.CustomTags includes "AddImport")  <- the one we want
//   "Atlas.Stripe"          (in-span fully-qualify; isCsFullyQualifyTitle owns it)
//   "Generate type 'Stripe'" / "Fix typo 'Stripe'"                   <- unwanted
// The using action's title carries a space AND a semicolon, so
// isCsFullyQualifyTitle (correctly) rejects it and qualifyImport returns nothing
// for it today. This drives a NEW extractor capability — importAction — against
// the REAL Roslyn LS over the REAL csharp-scratch fixture (Playground -> Atlas
// cross-project), proving the SEPARATE AddImport recognizer.
//
// Black-box contract (assert the EXTERNAL edit, never internals):
//   (a) MISSING using: importAction(Stripe cursor) -> a QualifyEdit that inserts
//       `using Atlas;` at the TOP of the file, its range OUTSIDE the function
//       span (line 0, above the `Go` declaration). NOT the in-span "Atlas.Stripe"
//       rewrite, NOT the "Generate type"/"Fix typo" edits.
//   (b) ALREADY-IMPORTED: importAction(Stripe cursor) -> undefined (Roslyn offers
//       no AddImport when the type is already imported) — no duplicate using.
//   (c) the pure recognizer isCsAddImportAction accepts ONLY the AddImport action
//       (CustomTags "AddImport") and rejects FullyQualify / Generate type / Fix
//       typo — proven over the real raw action shapes.
//
// RED before implementation: importAction does not exist on CsLspExtractor and
// isCsAddImportAction is not exported, so the capability call is undefined and the
// recognizer assertions fail.
//
// Gated: registered in package.json test:live only. Cold init ~12s; generous
// timeouts. Needs the csharp-scratch fixture and the Roslyn LS DLL. The throwaway
// probe files are created BEFORE project/open (so the SDK glob picks them into
// Playground.csproj and Atlas is reachable) and deleted in test.after.
// Run: node --test --test-concurrency=1 test/blind-goalmd-csusing-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"
);
const REPO = "/home/utilitydelta/repos/csharp-scratch";
const PLAYGROUND_DIR = path.join(REPO, "src/Playground");
const PLAYGROUND_CSPROJ = path.join(PLAYGROUND_DIR, "Playground.csproj");
const ATLAS_CSPROJ = path.join(REPO, "src/Atlas/Atlas.csproj");
const ATLAS_CS = path.join(REPO, "src/Atlas/Atlas.cs");

// Throwaway probe files (created before project load, deleted in test.after).
const MISSING_CS = path.join(PLAYGROUND_DIR, "UsingMissingProbe.cs");
const PRESENT_CS = path.join(PLAYGROUND_DIR, "UsingPresentProbe.cs");

const MISSING_SRC = [
  "namespace Playground;",
  "",
  "public static class UsingMissingProbe",
  "{",
  "    public static int Go()",
  "    {",
  "        var stripe = new Stripe();",
  "        return stripe.AggregateFanout();",
  "    }",
  "}",
  "",
].join("\n");
// The `Go` declaration head is line 4 (0-based); any edit ABOVE it is out of span.
const MISSING_FN_START_LINE = 4;
const MISSING_STRIPE_LINE = 6;

const PRESENT_SRC = [
  "using Atlas;",
  "",
  "namespace Playground;",
  "",
  "public static class UsingPresentProbe",
  "{",
  "    public static int Go()",
  "    {",
  "        var stripe = new Stripe();",
  "        return stripe.AggregateFanout();",
  "    }",
  "}",
  "",
].join("\n");
const PRESENT_STRIPE_LINE = 8;

// Cursor (0-based) at the `Stripe` type token in `new Stripe()` on a given line.
function stripeCursor(src, line) {
  const text = src.split("\n")[line];
  const character = text.indexOf("new Stripe") + "new ".length;
  return { line, character };
}

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-goalmd-csusing",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n` +
      `export { isCsAddImportAction } from "../src/core/csExtraction";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csusing.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-goalmd-csusing.bundle.cjs"), { force: true });
  };
}
const { CsLspExtractor, isCsAddImportAction } = mod;

const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;
const fixtureMissing = !fs.existsSync(ATLAS_CS) ? `csharp-scratch fixture not found at ${REPO}` : undefined;

// Probe files must exist on disk BEFORE the LS loads the project (the SDK glob
// only picks up files present at load time; a file opened later is a
// "miscellaneous" file with no project reference, so Atlas — and the AddImport —
// would be unreachable). Written once, up front, guarded by the fixture check.
let probesWritten = false;
function writeProbes() {
  if (probesWritten || fixtureMissing) return;
  fs.writeFileSync(MISSING_CS, MISSING_SRC);
  fs.writeFileSync(PRESENT_CS, PRESENT_SRC);
  probesWritten = true;
}
writeProbes();

test("bundle: the C# transport + recognizer build (CsLspExtractor + isCsAddImportAction exported) [surface: 'csLspExtractor.ts' + 'csExtraction.ts']", () => {
  if (bundleError) assert.fail(`the C# bundle did not build: ${bundleError.message}`);
  assert.strictEqual(typeof CsLspExtractor, "function", "CsLspExtractor class is exported");
  assert.strictEqual(typeof isCsAddImportAction, "function", "isCsAddImportAction recognizer is exported");
});

const gtest = (name, fn) =>
  test(name, async (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (dllMissing) return ctx.skip(dllMissing);
    if (fixtureMissing) return ctx.skip(fixtureMissing);
    return fn(ctx);
  });

// One shared extractor over the real fixture, BOTH projects loaded (Playground
// references Atlas cross-project; the AddImport `using Atlas;` is only offered
// when Atlas is a reachable, loaded reference). Started AFTER the probe files are
// on disk. Restored once.
let exP;
let restored = false;
const extractor = () =>
  (exP ||= (async () => {
    writeProbes();
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

// Code actions can lag a freshly initialized project until the compilation is
// ready; bounded retries absorb the index race without masking a genuine miss.
async function importActionWithSettle(ex, uri, cursor) {
  for (let attempt = 0; attempt < 14; attempt++) {
    const edit = await ex.importAction({ uri, ...cursor });
    if (edit) return edit;
    await sleep(600);
  }
  return undefined;
}

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  fs.rmSync(MISSING_CS, { force: true });
  fs.rmSync(PRESENT_CS, { force: true });
  cleanup();
});

// ===========================================================================
// (a) MISSING using -> the AddImport edit, routed to the TOP of the file.
// ===========================================================================
gtest("live: importAction at an unimported `Stripe` yields the `using Atlas;` edit at the file TOP, OUTSIDE the function span [surface: brief-p5 'route its edit OUT OF SPAN through offerOutOfSpanImport']", async () => {
  const ex = await extractor();
  const uri = pathToFileURL(MISSING_CS).href;
  const cursor = stripeCursor(MISSING_SRC, MISSING_STRIPE_LINE);
  const edit = await importActionWithSettle(ex, uri, cursor);
  assert.ok(edit, "the AddImport (`using Atlas;`) code action resolves to an out-of-span import edit");
  // The edit ADDS a `using Atlas;` directive (never the in-span `Atlas.Stripe`
  // rewrite, never a `Stripe`->`string` typo change).
  assert.match(edit.newText, /using\s+Atlas\s*;/, `the edit inserts a \`using Atlas;\` directive, got ${JSON.stringify(edit.newText)}`);
  // It lands OUT OF SPAN: at the top of the file, strictly ABOVE the `Go`
  // declaration head — an insertion, so start==end, both above the function.
  assert.ok(
    edit.range.startLine < MISSING_FN_START_LINE && edit.range.endLine < MISSING_FN_START_LINE,
    `the import edit lands above the function span (line < ${MISSING_FN_START_LINE}), got ${JSON.stringify(edit.range)}`
  );
  assert.strictEqual(edit.range.startLine, 0, `Roslyn inserts the using at the very top (line 0), got ${JSON.stringify(edit.range)}`);
});

// ===========================================================================
// (b) ALREADY-IMPORTED -> NO-OP (no duplicate using).
// ===========================================================================
gtest("live: importAction at an ALREADY-imported `Stripe` is a NO-OP (no AddImport offered, no duplicate using) [surface: brief-p5 'an already-imported type is a no-op']", async () => {
  const ex = await extractor();
  const uri = pathToFileURL(PRESENT_CS).href;
  const cursor = stripeCursor(PRESENT_SRC, PRESENT_STRIPE_LINE);
  // Settle: give the LS the same warm-up window the missing case gets, then
  // assert importAction stays dark (no `using Atlas;` action exists when the
  // type already resolves).
  let edit;
  for (let attempt = 0; attempt < 8; attempt++) {
    edit = await ex.importAction({ uri, ...cursor });
    if (edit) break;
    await sleep(400);
  }
  assert.strictEqual(edit, undefined, "an already-imported type offers no AddImport action, so importAction adds nothing");
});

// ===========================================================================
// (c) the pure recognizer over the REAL raw action shapes: AddImport ONLY.
// ===========================================================================
gtest("live: isCsAddImportAction accepts ONLY the AddImport action, rejecting FullyQualify / Generate type / Fix typo [surface: verify-p5 'key on data.CustomTags containing AddImport, cross-checked with /^using .+;$/']", async () => {
  const ex = await extractor();
  const uri = pathToFileURL(MISSING_CS).href;
  const cursor = stripeCursor(MISSING_SRC, MISSING_STRIPE_LINE);
  // Reach the RAW action list the extractor sees (the recognizer's input),
  // proving the discrimination over live shapes, not a hand-built fake.
  let actions = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    actions = await ex.rawCodeActionsForTest({ uri, ...cursor });
    if (actions.some((a) => typeof a.title === "string" && /^using\s.+;$/.test(a.title))) break;
    await sleep(600);
  }
  const accepted = actions.filter((a) => isCsAddImportAction(a));
  assert.strictEqual(accepted.length, 1, `exactly ONE action is recognized as AddImport, got ${JSON.stringify(accepted.map((a) => a.title))}`);
  assert.match(accepted[0].title, /^using\s.+;$/, "the accepted action is the `using ...;` directive");
  // The rejected set includes the real competitors we must never mistake for it.
  const rejectedTitles = actions.filter((a) => !isCsAddImportAction(a)).map((a) => a.title);
  for (const unwanted of ["Atlas.Stripe", "Generate type 'Stripe'"]) {
    assert.ok(
      rejectedTitles.includes(unwanted),
      `\`${unwanted}\` is present AND rejected by the recognizer, got rejected=${JSON.stringify(rejectedTitles)}`
    );
  }
});
