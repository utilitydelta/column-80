// Blind oracle, LIVE: the argument-type surface against a REAL language server
// and a REAL repo, plus the REAL 1.5b.
//
// This file exists because of a specific failure. v15 shipped an argument-type
// injection that was green in 2853 hermetic tests and broken in the editor: in
// C# the block titled `to build a Tile:` was filled with the enclosing helper
// class's own functions, and the model then invented a function shaped like the
// names it was shown. A human found it by typing a dot. Nothing here could.
//
// Every hermetic test in the repo answers "does the code do what the fake said".
// These answer "does the real server, over the real repo, give us what we think"
// - which is the question that was never asked.
//
// Fixture is ~/repos/csharp-scratch, unmodified: `Fim.cs` holds the helper class
// and merely MENTIONS Tile; `Tile` is defined in `Atlas.cs`. That two-file split
// is exactly the trap, and it is real code rather than a hand-written payload.
//
// Written against the surface docs and the session goal. Never reads src/**.
//
// Run: node --test test/blind-v16-argtype-live.test.cjs
//      SKIP_LIVE=1 node --test ...   (skipped)
// Needs: the Roslyn LS DLL, the csharp-scratch fixture, and for the last group
// ollama at 11434 with qwen2.5-coder:1.5b-base. Each is skipped, never failed,
// when absent: a missing instrument is not a failing contract.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("child_process");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"
);
const REPO = path.join(os.homedir(), "repos/csharp-scratch");
const PLAYGROUND_CSPROJ = path.join(REPO, "src/Playground/Playground.csproj");
const ATLAS_CSPROJ = path.join(REPO, "src/Atlas/Atlas.csproj");
const FIM_CS = path.join(REPO, "src/Playground/Fim.cs");
const ATLAS_CS = path.join(REPO, "src/Atlas/Atlas.cs");

const API_BASE = "http://localhost:11434";
const MODEL = "qwen2.5-coder:1.5b-base";

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v16-argtype",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n` +
      `export { findTypeAnchorInText } from "../src/core/fimWholeBlock";\n` +
      `export { renderFimCandidates, argumentTypeNames, narrowToPartial, lineCommentFor } from "../src/core/fimInject";\n`
  ));
} catch (e) {
  bundleError = e;
}
const { CsLspExtractor, findTypeAnchorInText, renderFimCandidates, argumentTypeNames, narrowToPartial, lineCommentFor } = mod;

const missing =
  (bundleError && `bundle failed: ${bundleError.message}`) ||
  (!fs.existsSync(ROSLYN_DLL) && `Roslyn LS not found at ${ROSLYN_DLL}`) ||
  (!fs.existsSync(FIM_CS) && `csharp-scratch fixture not found at ${REPO}`) ||
  undefined;

const gtest = (name, fn) =>
  test(name, { skip: SKIP }, async (ctx) => {
    if (missing) return ctx.skip(missing);
    return fn(ctx);
  });

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

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  cleanup();
});

const names = (ms) => ms.map((m) => m.name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The helper class's own functions. If any of these is ever presented as part of
// Tile's construction surface, the resolution reached the wrong declaration.
const HELPERS = ["TileSite", "StripeMutatorSite", "MemberOverloadSite", "GenericCommaSite", "EnumSite", "WideReceiverSite", "FreshSite"];

// documentSymbol can lag a cold project; bounded retries absorb the index race
// without masking a genuine empty.
async function membersWithSettle(ex, cursor) {
  for (let i = 0; i < 8; i++) {
    const ms = await ex.membersOfType(cursor);
    if (ms.length > 0) return ms;
    await sleep(400);
  }
  return [];
}

// ===========================================================================
// 1. The identity of the argument-type surface, over the real server.
//
// This is the group that would have caught the v15 defect with no human in the
// loop. The anchor for `Tile` inside Fim.cs is a REFERENCE; the members must
// come from Tile's DEFINITION in Atlas.cs.
// ===========================================================================

gtest("live: the same-file text anchor for `Tile` lands on a REFERENCE inside the helper class, not on Tile's definition", async () => {
  const text = fs.readFileSync(FIM_CS, "utf8");
  const anchor = findTypeAnchorInText(text, "Tile");
  assert.ok(anchor, "the anchor scan finds a mention of Tile in Fim.cs");
  const line = text.split("\n")[anchor.line];
  assert.ok(
    !/\b(class|struct|record)\s+Tile\b/.test(line),
    `the anchor is a reference, so it must NOT be treated as a definition cursor; line was: ${line.trim()}`
  );
});

gtest("live: reading members AT THE RAW ANCHOR returns the HELPER class - the v15 defect, pinned so it can never be mistaken for correct", async () => {
  const ex = await extractor();
  const text = fs.readFileSync(FIM_CS, "utf8");
  const anchor = findTypeAnchorInText(text, "Tile");
  const at = { uri: pathToFileURL(FIM_CS).href, line: anchor.line, character: anchor.character };
  const got = names(await membersWithSettle(ex, at));
  // Not an assertion that this is DESIRABLE. It documents what the raw anchor
  // yields, so the reason the definition() hop exists stays visible.
  assert.ok(
    got.some((n) => HELPERS.includes(n)),
    `a raw reference cursor resolves the ENCLOSING declaration; if this ever stops being true the definition() hop may be redundant. got ${JSON.stringify(got)}`
  );
});

gtest("live: resolving the anchor through definition() lands in Atlas.cs and yields TILE's surface, with no helper name anywhere", async () => {
  const ex = await extractor();
  const text = fs.readFileSync(FIM_CS, "utf8");
  const anchor = findTypeAnchorInText(text, "Tile");
  const ref = { uri: pathToFileURL(FIM_CS).href, line: anchor.line, character: anchor.character };

  const def = await ex.definition(ref);
  assert.ok(def, "the reference must resolve to a definition");
  assert.ok(def.uri.endsWith("Atlas.cs"), `Tile is defined in Atlas.cs; definition() answered ${def.uri}`);

  const members = await membersWithSettle(ex, {
    uri: def.uri,
    line: def.range.startLine,
    character: def.range.startCharacter,
  });
  const got = names(members);
  assert.deepStrictEqual(
    got.filter((n) => HELPERS.includes(n)),
    [],
    `no helper-class function may appear in Tile's construction surface; got ${JSON.stringify(got)}`
  );
  assert.ok(got.includes("Tile"), `Tile's constructor carries the arity and must be present; got ${JSON.stringify(got)}`);
});

gtest("live: the rendered block states Tile's TWO-argument construction, so `new Tile(1)` is unwritable from it", async () => {
  const ex = await extractor();
  const text = fs.readFileSync(FIM_CS, "utf8");
  const anchor = findTypeAnchorInText(text, "Tile");
  const def = await ex.definition({ uri: pathToFileURL(FIM_CS).href, line: anchor.line, character: anchor.character });
  const members = await membersWithSettle(ex, { uri: def.uri, line: def.range.startLine, character: def.range.startCharacter });

  const block = renderFimCandidates([{ name: "EnrollTile", signature: "bool Stripe.EnrollTile(Tile tile)", kind: "method" }], "", "//", [
    { name: "Tile", members },
  ]);
  assert.ok(block, "a block renders");
  assert.ok(block.includes("to build a Tile:"), `the construction section must be present:\n${block}`);
  const ctorLine = block.split("\n").find((l) => /\bTile\s*\(/.test(l) && !l.includes("to build"));
  assert.ok(ctorLine, `a constructor line must be present:\n${block}`);
  assert.ok(
    /\(.*,.*\)/.test(ctorLine),
    `the constructor takes mortonCode AND lod; a block that does not say so is why the model wrote new Tile(1). line was: ${ctorLine}`
  );
});

// ===========================================================================
// 2. Budget honesty. The injected block is CAPPED, so every line spent on a
// member no caller would reach is a line denied to a real one. Observed in the
// dogfood run: four of eleven C# lines were System.Object members.
// ===========================================================================

gtest("live: the receiver block does not spend its capped budget on System.Object members", async () => {
  const ex = await extractor();
  const src = fs.readFileSync(FIM_CS, "utf8").split("\n");
  const line = src.findIndex((l) => l.includes("stripe.EnrollTile"));
  assert.ok(line >= 0, "the fixture still has a stripe member site");
  const dot = src[line].indexOf("stripe.") + "stripe.".length;

  const members = await ex.completeMembers({ uri: pathToFileURL(FIM_CS).href, line, character: dot });
  const block = renderFimCandidates(narrowToPartial(members, ""), "", "//", []) ?? "";
  const noise = ["object.Equals", "object.GetHashCode", "object.GetType", "object.ToString"].filter((n) => block.includes(n));
  assert.deepStrictEqual(
    noise,
    [],
    `System.Object members carry no crate-specific signal and the block is capped; ${noise.length} slots were spent on them:\n${block}`
  );
});

// ===========================================================================
// 3. The end-to-end claim, against the REAL 1.5b.
//
// goal.md (v15) rests on one measured number: constructor arity 0/8 without the
// argument-type block, 8/8 with it. That was measured by a throwaway spike that
// no longer runs. Nothing in the suite re-checks it, so the number cannot rot
// visibly. These rows make it an oracle.
// ===========================================================================

async function modelUp() {
  try {
    const r = await fetch(`${API_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const tags = (await r.json()).models.map((m) => m.name);
    return tags.includes(MODEL) ? undefined : `${MODEL} is not pulled`;
  } catch {
    return "ollama is not reachable at 11434";
  }
}

async function infill(prefix, suffix) {
  const r = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
      stream: false,
      options: { temperature: 0.01, num_predict: 64 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  return (await r.json()).response ?? "";
}

// The member site the whole feature exists for: `stripe.` where EnrollTile takes
// a user-defined Tile whose constructor takes two arguments.
const SITE_PREFIX = `using Atlas;

namespace Playground;

public static class Probe
{
    public static bool Run()
    {
        Stripe stripe = new();
        return stripe.`;
const SITE_SUFFIX = `
    }
}
`;

gtest("live 1.5b: WITHOUT the argument-type block the model gets Tile's arity wrong - the baseline the feature exists to move", async (ctx) => {
  const why = await modelUp();
  if (why) return ctx.skip(why);
  const out = await infill(SITE_PREFIX, SITE_SUFFIX);
  const call = /new\s+Tile\s*\(([^)]*)\)/.exec(out);
  if (!call) return ctx.skip(`the model did not construct a Tile at all; got: ${out.trim().slice(0, 120)}`);
  const argc = call[1].trim() === "" ? 0 : call[1].split(",").length;
  assert.notStrictEqual(argc, 2, `baseline row: with no injected surface the model is expected to MISS the arity. It wrote new Tile(${call[1]}). If this starts passing, the base model improved and the feature's justification needs re-measuring.`);
});

gtest("live 1.5b: WITH the argument-type block injected, the model constructs Tile with BOTH arguments", async (ctx) => {
  const why = await modelUp();
  if (why) return ctx.skip(why);
  const ex = await extractor();
  const text = fs.readFileSync(FIM_CS, "utf8");
  const anchor = findTypeAnchorInText(text, "Tile");
  const def = await ex.definition({ uri: pathToFileURL(FIM_CS).href, line: anchor.line, character: anchor.character });
  const members = await membersWithSettle(ex, { uri: def.uri, line: def.range.startLine, character: def.range.startCharacter });

  const block = renderFimCandidates([{ name: "EnrollTile", signature: "bool Stripe.EnrollTile(Tile tile)", kind: "method" }], "", "//", [
    { name: "Tile", members },
  ]);
  assert.ok(block, "the injection must render, or this row is measuring nothing");

  const indented = block
    .split("\n")
    .map((l) => `        ${l}`)
    .join("\n");
  const out = await infill(`${SITE_PREFIX.slice(0, SITE_PREFIX.lastIndexOf("return stripe."))}${indented}\n        return stripe.`, SITE_SUFFIX);

  const call = /new\s+Tile\s*\(([^)]*)\)/.exec(out);
  assert.ok(call, `with Tile's constructor in view the model should construct one; got: ${out.trim().slice(0, 160)}`);
  const argc = call[1].trim() === "" ? 0 : call[1].split(",").length;
  assert.strictEqual(
    argc,
    2,
    `Tile(int mortonCode, int lod) takes two. This is the number goal.md rests on (0/8 -> 8/8); it wrote new Tile(${call[1]})`
  );
});
