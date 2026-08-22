// IMPLEMENTATION oracle (LIVE) for session-v28 phase 3: the FIM enum-RHS leg,
// replayed end to end against the real Roslyn language server and the real 1.5b.
//
// The acceptance bar, goal item 3 verbatim: "At `t.Band == ` in
// the captured file the block lists Municipal/Regional/Continental/Parcel and
// the ghost completes `LodBand.Regional` against the doc-comment intent."
//
// Why live, and why nothing smaller proves it. Three of the four claims in that
// sentence are claims about somebody else's software. That the site fires is
// pure and cheap. That `Band` hovers as `LodBand Tile.Band { get; }` in a buffer
// the human has left mid-expression is Roslyn's answer, in a broken parse, over
// a two-project solution where the type is defined in the OTHER project. That
// the four variants come back at all is the cross-file walk's answer. And that
// the ghost lands `LodBand.Regional` is this model's answer to this prompt: the
// whole leg exists because the same model at the same site wrote
// ` Band.Regional).Count();`, a value that does not exist. A stub anywhere in
// that chain measures the stub.
//
// The legs, in the order the product runs them:
//   1. enumRhsSiteFor("csharp") fires at the captured prefix, and
//      memberSiteFor("csharp") does NOT (a member site wins, so a member site
//      here would mean this leg never runs in the editor)
//   2. the resolution ladder against the real server -> the rendered block
//   3. the ghost, through the real CompletionService at the shipped FIM config,
//      WITH the block and WITHOUT it, five samples each
//   3b. the same block at the next keystroke, recorded and not asserted
//
// STATE, measured 2026-07-26, 5 samples per arm:
//
//   * the block renders in full, 4 of 4 variants, off a hover taken in a buffer
//     that does not parse: `LodBand Tile.Band { get; }`.
//   * block arm, 5/5: ` LodBand.Regional).Count();` - the line the human said
//     they were expecting, byte for byte past the cursor.
//   * control arm, 0/5: nothing served at all. The raw model wrote ` 0).Count();`
//     (an enum compared to an int literal) and then carried on authoring a
//     second method; the plain-FIM bound and the postprocess drop the lot, so
//     what the human sees today at this site is no ghost rather than a wrong
//     one. That is a shift from the goal's own capture, which served
//     ` Band.Regional).Count();` - and is why the raw line is recorded too.
//   * spaced arm, 5/5 `"LodBand.Regional"`, quoted. See below.
//   * spaced CONTROL arm, 0/5: nothing served, raw `1).Count();` - the same
//     enum-against-an-int-literal the unspaced control writes. Plain FIM is not
//     right at that state either, so the quoting is the model's rather than
//     something the block introduced. What the block DOES change there is that
//     something wrong gets served where nothing was.
//
// RE-MEASURED 2026-07-26, after the enum-RHS VALUE gate shipped, same 5 samples
// per arm and the same block:
//
//   * captured state, block arm: 5/5 ` LodBand.Regional).Count();`, unchanged.
//     The gate has no opinion on a bare variant, which is the whole design.
//   * captured state, control arm: 0/5, raw ` 0).Count();`, unchanged.
//   * spaced state, block arm: 0/5, nothing served. The model still wrote
//     `"LodBand.Regional"` 5 of 5 and the gate refused all five, naming the
//     reason on the channel: a string is never the value of an enum-typed
//     comparison. That is the shift this gate exists for - "something wrong"
//     back to "nothing" at the state where the block was doing harm.
//   * spaced state, control arm: 0/5, raw `1).Count();`, unchanged and ungated
//     (no block landed, so the gate stays dark).
//
// THE FIXTURE IS THE HUMAN'S. `~/repos/csharp-scratch` is a dogfood playground,
// not a test asset. This file writes the capture state into Fim.cs and restores
// the original bytes unconditionally in test.after and again on process exit. A
// run that leaves the playground modified is a defect in this file.
//
// WHAT THE CAPTURED STATE IS. `docs/architecture/fn-generation.md`, "The dark
// reject", plain-FIM bullet: the human was mid-edit on
// `return tiles.Where(t => t.IsRegional).Count();`, had
// replaced the middle with `t.Band ==`, and the closing `).Count();` still sat
// AFTER the cursor - which is why the capture's ghost re-typed it. So the buffer
// this file writes holds the whole line, `).Count();` included, and the cursor
// splits it at the operator. That does not parse, and it is not meant to: an
// enum-RHS site only exists in a buffer the human has not finished. The suffix
// re-type itself is a postprocess question deferred at the time, and is NOT
// this file's bar.
//
// WHERE THE CURSOR SITS, and why it is not where goal.md's prose puts it.
// goal.md writes the site as `t.Band == `, trailing space included. The capture
// it quotes says otherwise: the logged ghost is `" Band.Regional).Count();"`,
// and that LEADING SPACE is the model supplying the separator, which it only
// does when the buffer does not already have one. So the captured cursor sits
// immediately after `==`, and that is the state leg 3 holds to the acceptance.
//
// The trailing-space state is real too - it is the very next keystroke - so it
// is measured as its own recorded arm, and what it produced is the finding of
// this file. Same block, same model, one space later: the ghost is
// `"LodBand.Regional"`, a quoted STRING, which does not compile. Recorded, never
// asserted: pinning it would make a defect a contract. The value gate now
// refuses that ghost before it reaches the human, and the arm stays RECORDED for
// the same reason - what the model writes there is still the model's, and the
// gate's job is only that it never lands on screen.
//
// THE LADDER IS MIRRORED, and that is worth being upfront about. Every RUNG is
// the product's own exported function - enumRhsSiteFor, memberTypeNameFor,
// typeSpellingFor, argTypeStopRulesFor, findTypeAnchorInText,
// resolveCrossFileShape, shapeHooksFor, renderEnumVariants, lineCommentFor, and the whole
// CompletionService for the generation. What is copied is the ORCHESTRATION
// between them, because it lives in `CompletionProvider.resolveEnumRhs`, a
// private method on a class that needs a live VS Code window to construct. The
// copy is marked MIRROR at each step and kept to the sequence and the bounds;
// no rung is reimplemented, so a change to any rung's behaviour reaches this
// file. A change to the ORDER does not, which is the cost, and the honest place
// to close it is a headless seam on the provider rather than a fake window here.
//
// Gated: NOT registered in package.json test:live. A frozen blind test pins that
// list by exact equality, and the blind set is never edited to make something
// pass; whether this file joins the contract is the human's call. Skips (never
// fails) without the Roslyn DLL, the fixture, dotnet or ollama; SKIP_LIVE=1
// skips the whole file.
// Run: node --test --test-concurrency=1 test/impl-v28-p3-enumrhs-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { execFileSync } = require("child_process");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
// A cold Roslyn cross-project load is the slow part; the 1.5b is not.
const LSP_TIMEOUT = 300_000;
// Ten generations plus the shipped 150ms debounce on each.
const GHOST_TIMEOUT = 300_000;

const API_BASE = "http://localhost:11434";
// The shipped FIM model, and the one both captures in goal.md item 3 came from.
const MODEL = "qwen2.5-coder:1.5b-base";

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll",
);
const REPO = path.join(os.homedir(), "repos/csharp-scratch");
const PLAYGROUND_CSPROJ = path.join(REPO, "src/Playground/Playground.csproj");
const ATLAS_CSPROJ = path.join(REPO, "src/Atlas/Atlas.csproj");
const FIM_CS = path.join(REPO, "src/Playground/Fim.cs");
const FIM_URI = pathToFileURL(FIM_CS).href;

// How many samples per arm, and the bar the BLOCK arm is held to. One
// generation at temperature 0.01 is one sample and this file asserts a rate, so
// the rule is written here rather than inferred from a comparison further down:
//
//   the block arm must land `LodBand.Regional` in a STRICT MAJORITY of its
//   samples, 3 of 5.
//
// Not 5 of 5: a bar set at the observed number turns any future sampling wobble
// into a red run that says nothing about the leg. Not 1 of 5 either, which a
// coin flip passes. The control arm asserts NOTHING at all - it is recorded, and
// what it records is the contrast the goal rests on.
const SAMPLES = 5;
const BLOCK_ARM_FLOOR = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===========================================================================
// The bundle. Pure core: the extractor, the cross-file walk, the injection
// renderers and the completion service. No vscode stub, because nothing on this
// path imports vscode - the provider's own `openDocumentText` seam is the one
// thing that does, and this file passes a disk reader in its place, which is
// what that parameter is a seam FOR.
// ===========================================================================

const ENTRY = path.join(__dirname, ".impl-v28-p3-live.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v28-p3-live.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export {
  enumRhsSiteFor,
  memberSiteFor,
  memberTypeNameFor,
  memberTypeContainerFor,
  typeSpellingFor,
  renderEnumVariants,
  injectBeforeCursorLine,
  lineCommentFor,
  argTypeStopRulesFor,
} from "../src/core/fimInject";
export { CsLspExtractor } from "../src/core/csLspExtractor";
export { resolveCrossFileShape, shapeHooksFor } from "../src/core/crossFileShape";
export { findTypeAnchorInText } from "../src/core/fimWholeBlock";
export { CompletionService } from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";
export { listModels, generateFim } from "../src/core/ollama";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}

// ===========================================================================
// The capture, written into the human's playground and taken back out again.
// ===========================================================================

// The doc comment is the fixture's own, unchanged: it is the intent the
// acceptance measures the ghost against, and rewriting it would make this file
// grade a sentence nobody dictated. `Where(t => t.Band == ` is the capture's own
// line, `).Count();` is the part that was already sitting past the cursor.
const CAPTURE = `    /// <summary>
    /// how many regional tiles (checking band)
    /// </summary>
    public static int RegionLodCount(List<Tile> tiles)
    {
        return tiles.Where(t => t.Band == ).Count();
    }`;

// Where the cursor sits. `CURSOR_AFTER` is the captured state (the logged ghost
// supplies its own leading space, so the buffer had none); `CURSOR_AFTER_SPACED`
// is the same site one keystroke later. The detector accepts both.
const CURSOR_AFTER = "t.Band ==";
const CURSOR_AFTER_SPACED = "t.Band == ";

const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;
const fixtureMissing = !fs.existsSync(FIM_CS) ? `csharp-scratch fixture not found at ${FIM_CS}` : undefined;
let dotnetMissing;
try {
  execFileSync("dotnet", ["--version"], { timeout: 60000, stdio: "ignore" });
} catch (e) {
  dotnetMissing = `dotnet is not runnable on PATH: ${e.message}`;
}

let originalBytes;
let armed = false;
let armError;
// The capture state, computed off the text actually written to disk. Nothing
// here is a remembered offset: a fixture edit moves every number.
let CAP = {};

function restoreFixture() {
  if (armed && originalBytes !== undefined) {
    fs.writeFileSync(FIM_CS, originalBytes);
    armed = false;
  }
}

// Replace the RegionLodCount method (the `///` block above its declaration plus
// the brace-matched body) with the capture. Located by its declaration rather
// than by line numbers, so the human editing the rest of the playground does not
// break this.
function armFixture() {
  originalBytes = fs.readFileSync(FIM_CS);
  const text = originalBytes.toString("utf8");
  const decl = text.indexOf("public static int RegionLodCount");
  if (decl < 0) {
    throw new Error("fixture no longer declares RegionLodCount");
  }
  let start = text.lastIndexOf("\n", decl) + 1;
  for (;;) {
    const prevEnd = start - 1;
    const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
    if (prevEnd <= 0 || !text.slice(prevStart, prevEnd).trim().startsWith("///")) {
      break;
    }
    start = prevStart;
  }
  const open = text.indexOf("{", decl);
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (open < 0 || end < 0) {
    throw new Error("could not brace-match the RegionLodCount body");
  }
  const next = text.slice(0, start) + CAPTURE + text.slice(end);

  // The cursor, off the written text. Uniqueness is checked rather than
  // assumed: a second `t.Band == ` anywhere in the playground would split the
  // buffer at the wrong one and every number below would describe some other
  // site.
  const at = next.indexOf(CURSOR_AFTER);
  if (at < 0 || next.indexOf(CURSOR_AFTER, at + 1) >= 0) {
    throw new Error(`the armed fixture must contain exactly one ${JSON.stringify(CURSOR_AFTER)}`);
  }
  const cursor = at + CURSOR_AFTER.length;
  fs.writeFileSync(FIM_CS, next, "utf8");
  armed = true;

  CAP = {
    text: next,
    cursorOffset: cursor,
    // What the provider hands the service: the document split at the cursor.
    // The service applies the shipped 3000/1000 char windows itself.
    prefix: next.slice(0, cursor),
    suffix: next.slice(cursor),
    // The same site one keystroke later, the state goal.md's prose describes.
    spacedPrefix: next.slice(0, cursor + 1),
    spacedSuffix: next.slice(cursor + 1),
  };
  if (!CAP.spacedPrefix.endsWith(CURSOR_AFTER_SPACED)) {
    throw new Error("the spaced cursor must sit one character past the captured one");
  }
}

if (!SKIP && !fixtureMissing && !bundleErr) {
  try {
    armFixture();
  } catch (e) {
    armError = e;
    restoreFixture();
  }
}
// Belt and braces: an assertion that kills the process must not leave the
// human's playground carrying a half-written expression.
process.on("exit", restoreFixture);

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  restoreFixture();
  for (const f of [ENTRY, OUTFILE]) {
    fs.rmSync(f, { force: true });
  }
});

// ===========================================================================
// Harness.
// ===========================================================================

let restoredNuget = false;
let exP;
const extractor = () =>
  (exP ||= (async () => {
    if (!restoredNuget) {
      execFileSync("dotnet", ["restore", PLAYGROUND_CSPROJ], { cwd: REPO, timeout: 180000, stdio: "ignore" });
      restoredNuget = true;
    }
    // BOTH projects. `Tile` and `LodBand` live in Atlas, the site lives in
    // Playground; a single-project load cannot resolve the capture at all.
    const ex = await B.CsLspExtractor.start({
      projectRoot: REPO,
      csproj: [pathToFileURL(PLAYGROUND_CSPROJ).href, pathToFileURL(ATLAS_CSPROJ).href],
      serverDll: ROSLYN_DLL,
    });
    await ex.whenReady();
    return ex;
  })());

// The cross-file walk's `openFile` seam. The provider fills this with
// `vscode.workspace.openTextDocument`; on disk is the same answer here, because
// the buffer under test IS on disk.
async function openFile(uri) {
  try {
    return fs.readFileSync(uri.startsWith("file:") ? fileURLToPath(uri) : uri, "utf8");
  } catch {
    return undefined;
  }
}

let ollamaSkip;
async function ollamaMissing() {
  if (ollamaSkip !== undefined) {
    return ollamaSkip;
  }
  try {
    const tags = await B.listModels(API_BASE);
    ollamaSkip = Array.isArray(tags) && tags.includes(MODEL) ? false : `${MODEL} is not pulled on ${API_BASE}`;
  } catch (e) {
    ollamaSkip = `ollama unreachable at ${API_BASE}: ${e.message}`;
  }
  return ollamaSkip;
}

// Every guard skips. A missing toolchain is not a failing contract.
const gtest = (name, opts, fn) =>
  test(name, opts, async (ctx) => {
    if (SKIP) return ctx.skip(SKIP);
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    if (fixtureMissing) return ctx.skip(fixtureMissing);
    if (armError) return ctx.skip(`fixture could not be armed: ${armError.message}`);
    if (dllMissing) return ctx.skip(dllMissing);
    if (dotnetMissing) return ctx.skip(dotnetMissing);
    return fn(ctx);
  });

// What each leg hands the next. Shared across rows so the server is asked once
// and the generation legs judge the SAME block.
const state = {};

test("bundle guard: the phase-3 enum-RHS path builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of [
    "enumRhsSiteFor",
    "memberSiteFor",
    "memberTypeNameFor",
    "memberTypeContainerFor",
    "typeSpellingFor",
    "renderEnumVariants",
    "injectBeforeCursorLine",
    "lineCommentFor",
    "argTypeStopRulesFor",
    "CsLspExtractor",
    "resolveCrossFileShape",
    "shapeHooksFor",
    "findTypeAnchorInText",
    "CompletionService",
    "DEFAULT_FIM_CONFIG",
    "listModels",
  ]) {
    assert.ok(B[n] !== undefined, `${n} must be exported`);
  }
});

// ===========================================================================
// Leg 1. The SITE. Pure, no server, no model.
//
// Both halves matter. That the enum site fires is the leg existing at all; that
// the member site does NOT fire there is the leg ever running, because the
// provider orders the member site first and an enum site is computed only where
// no member site was found.
// ===========================================================================

// Both cursor states, because the human passes through both in two keystrokes
// and the leg has to survive that. Same row, one table: they differ in data.
gtest(
  "leg 1: `t.Band ==` and `t.Band == ` are both enum-RHS sites and neither is a member site [design-p3: 'a member site wins']",
  {},
  (ctx) => {
    for (const [label, prefix] of [
      ["captured (no trailing space)", CAP.prefix],
      ["one keystroke later (trailing space)", CAP.spacedPrefix],
    ]) {
      const site = B.enumRhsSiteFor("csharp")(prefix);
      ctx.diagnostic(`enum-rhs site, ${label}: ${JSON.stringify(site)}`);
      assert.ok(site, `${label}: the prefix must fire the site; it ends ${JSON.stringify(prefix.slice(-40))}`);
      assert.strictEqual(
        site.member,
        "Band",
        `${label}: the site must hand back the LEFT side's member token, which is what the resolver hovers. got ${JSON.stringify(site)}`,
      );
      // The offset is a cursor, so it has to point at the token in the real
      // buffer rather than merely be a number. The prefix IS the document up to
      // the cursor, so a prefix offset is a document offset here.
      assert.strictEqual(
        CAP.text.slice(site.offset, site.offset + site.member.length),
        "Band",
        `${label}: the offset must land on the member token in the buffer; it points at ${JSON.stringify(
          CAP.text.slice(site.offset, site.offset + 12),
        )}`,
      );
      assert.strictEqual(
        B.memberSiteFor("csharp")(prefix),
        undefined,
        `${label}: a member site here would win the ordering and this leg would never run in the editor`,
      );
      // Leg 2 hovers the CAPTURED state's site. Both states hand back the same
      // token at the same offset, but which one the ladder ran on should not be
      // an accident of loop order.
      if (prefix === CAP.prefix) {
        state.site = site;
      }
    }
  },
);

// ===========================================================================
// Leg 2. The RESOLUTION, against the real server.
//
// MIRROR of CompletionProvider.resolveEnumRhs. Every rung below is the
// product's own function; the sequence and the bounds are the copy. See the
// header for why.
// ===========================================================================

// One pass of the ladder. Returns the block, or a string saying which rung went
// dark - the same information the provider's `dark(reason)` puts on its channel,
// which is what a cold-start retry needs to report if it never settles.
async function resolveEnumRhsMirror(ex, site) {
  const languageId = "csharp";
  const readMemberType = B.memberTypeNameFor(languageId);
  if (readMemberType === undefined) {
    return { dark: "this language has no hover reader for a member's declared type" };
  }
  const readTypeSpelling = B.typeSpellingFor(languageId);
  if (readTypeSpelling === undefined) {
    return { dark: "this language has no reader for how a type must be spelled here" };
  }
  // Rung 1: hover the member token. The provider derives this cursor from the
  // site offset and the prefix; the prefix is the document up to the cursor, so
  // the arithmetic is the same one, done off the document.
  const beforeMember = CAP.text.slice(0, site.offset);
  const memberCursor = {
    uri: FIM_URI,
    line: beforeMember.split("\n").length - 1,
    character: site.offset - (beforeMember.lastIndexOf("\n") + 1),
  };
  let hover;
  try {
    hover = await ex.hoverSurface(memberCursor);
  } catch {
    hover = undefined;
  }
  const typeName = readMemberType(hover?.signature);
  if (typeName === undefined) {
    return { dark: `the hover named no declared type for the member (hover: ${JSON.stringify(hover?.signature)})`, hover };
  }
  // Rung 1b: a primitive or a library container is not worth two more round
  // trips. Same test the provider makes, off the same registry.
  if (!/^[A-Z]/.test(typeName) || B.argTypeStopRulesFor(languageId).std.has(typeName)) {
    return { dark: `the member's type \`${typeName}\` is not a user type`, hover, typeName };
  }
  // Rung 3, hoisted so rung 2 can use it twice: the shape. ONE type, no edges -
  // an enum collaborates with nothing.
  const shapeAt = async (cursor) => {
    try {
      const shape = await B.resolveCrossFileShape(
        ex,
        cursor,
        { D_MAX: 0, N_MAX: 1 },
        openFile,
        B.shapeHooksFor(languageId),
      );
      return shape?.types.get(typeName);
    } catch {
      return undefined;
    }
  };
  // Rung 2: anchor the type. Same-file reference first, then the by-name
  // workspace-symbol leg for a type defined in another project. The first rung
  // is a guess - C# idiom names a property after its enum type, so the first
  // occurrence of the word is often that property - so what it resolved to is
  // read for whether it declares a TYPE at all, and a member hover sends the
  // ladder to the second rung instead of dark.
  const at = B.findTypeAnchorInText(CAP.text, typeName);
  let derived;
  let anchor;
  let anchoredBy;
  if (at) {
    anchor = { uri: FIM_URI, line: at.line, character: at.character };
    anchoredBy = "this file's own reference";
    derived = await shapeAt(anchor);
    if (derived !== undefined && readTypeSpelling(derived.signature, CAP.text) === undefined) {
      derived = undefined;
    }
  }
  if (derived === undefined && ex.resolveTypeCursorByName) {
    // The rung asks with the qualification the hover already carried, so a name
    // declared in two namespaces is decided rather than refused. Same call the
    // provider makes, off the same registry row.
    const container = B.memberTypeContainerFor(languageId)?.(hover?.signature);
    let byName;
    try {
      byName = (await ex.resolveTypeCursorByName(typeName, { container, fileText: CAP.text })) ?? undefined;
    } catch {
      byName = undefined;
    }
    if (byName) {
      anchor = byName;
      anchoredBy = "the workspace symbol";
      derived = await shapeAt(byName);
    }
  }
  if (!anchor) {
    return { dark: `\`${typeName}\` could not be anchored to a definition`, hover, typeName };
  }
  if (derived === undefined) {
    return { dark: `\`${typeName}\` resolved to no shape`, hover, typeName, anchor };
  }
  const kind = derived.signature.trim();
  if (kind === "") {
    return { dark: `the definition of \`${typeName}\` hovered as nothing`, hover, typeName, anchor };
  }
  if (!/^enum\b/.test(kind)) {
    return { dark: `\`${typeName}\` is not an enum (hovered as ${JSON.stringify(kind)})`, hover, typeName, anchor };
  }
  // Rung 4: how the type must be SPELLED in this buffer, then the variants as
  // the resolver's own `enumMemberLine` hook spelled them with that qualifier
  // swapped onto the front, then the product's renderer.
  const spelling = readTypeSpelling(kind, CAP.text);
  if (spelling === undefined) {
    return { dark: `the definition of \`${typeName}\` hovered without a name this file can spell`, hover, typeName, anchor };
  }
  const variants = derived.methods
    .filter((l) => l.startsWith(`${typeName}.`))
    .map((l) => spelling + l.slice(typeName.length));
  const block = B.renderEnumVariants(spelling, variants, B.lineCommentFor(languageId));
  if (block === undefined) {
    return { dark: `\`${typeName}\` is an enum that resolved no variants`, hover, typeName, anchor };
  }
  return { block, hover, typeName, spelling, anchor, anchoredBy, kind, variants };
}

gtest(
  "leg 2: at the captured site the block lists Municipal/Regional/Continental/Parcel under `LodBand` [goal.md item 3 acceptance, first half]",
  { timeout: LSP_TIMEOUT },
  async (ctx) => {
    const site = state.site ?? B.enumRhsSiteFor("csharp")(CAP.prefix);
    if (!site) return ctx.skip("the site did not fire; see leg 1");
    const ex = await extractor();
    // Roslyn answers hover, workspace-symbol and documentSymbol only once the
    // cross-project load has settled. Bounded retries absorb that; the LAST
    // attempt is what the assertions read, so a permanent miss reports the rung
    // it actually died on rather than a stale one.
    let out;
    for (let attempt = 0; attempt < 15; attempt++) {
      out = await resolveEnumRhsMirror(ex, site);
      if (out.block) {
        break;
      }
      await sleep(1000);
    }
    state.block = out.block;
    const dump = `\n  HOVER: ${JSON.stringify(out.hover?.signature)}\n  TYPE: ${out.typeName}\n  ANCHOR: ${JSON.stringify(
      out.anchor,
    )}\n  BLOCK:\n${out.block ?? "(none)"}`;
    // Green or red, the evidence goes on the record. A live run whose only
    // output is "ok" teaches the next reader nothing about what the server said.
    ctx.diagnostic(`member hover: ${JSON.stringify(out.hover?.signature)}`);
    ctx.diagnostic(`anchored via: ${out.anchoredBy}, spelled ${out.spelling}`);
    ctx.diagnostic(`enum-rhs block:\n${out.block ?? `(dark: ${out.dark})`}`);

    assert.ok(out.block, `the block must render; the ladder went dark: ${out.dark}${dump}`);
    // The spelling is the SHORT one here, and that is a fact about this fixture
    // rather than a rule: Fim.cs carries `using Atlas;`, so `LodBand.Regional`
    // resolves in it. A file that reached the enum through a namespace it did
    // not import would get the qualified name, which is the point of the rung.
    assert.strictEqual(
      out.spelling,
      "LodBand",
      `this fixture imports the enum's namespace, so the short name is what compiles at the site.${dump}`,
    );
    assert.strictEqual(
      out.typeName,
      "LodBand",
      `the hover must name \`Band\`'s declared type, in a buffer that does not parse - that is the whole rung.${dump}`,
    );
    assert.match(
      out.block,
      /^\/\/ LodBand values \(use one of these exact names, do not invent\):$/m,
      `the header must name the TYPE, which is the one thing the captured plain-FIM ghost could not know.${dump}`,
    );
    // The acceptance names four. Each is checked as the SPELLING the model has
    // to write, `LodBand.Regional`, not as a bare word that would also match the
    // header or a doc comment.
    for (const v of ["Municipal", "Regional", "Continental", "Parcel"]) {
      assert.ok(
        out.block.split("\n").includes(`// LodBand.${v}`),
        `the block must list \`LodBand.${v}\` on its own line; an enum is a closed set and a partial list under a "do not invent" header is a lie.${dump}`,
      );
    }
    // Nothing else. A fifth line would mean a member arrived that is not a
    // value of this type, and the header says these are its values.
    assert.strictEqual(
      out.block.split("\n").length,
      5,
      `the block is a header plus the four variants and nothing else.${dump}`,
    );
  },
);

// ===========================================================================
// Leg 3. The GHOST, against the real 1.5b, through the real service.
//
// The service is the product: it applies the shipped 3000/1000 windows, injects
// the block with `injectBeforeCursorLine`, calls ollama at the shipped
// temperature and token cap, and runs the real postprocess, bound, floor and
// suffix trim on what comes back. The two arms differ in ONE field,
// `resolveInjection`, and nothing else - the bound, the comment rule and the
// gate all key off `memberSite`/`wholeBlockSite`, which are false in both, so
// the block is the only variable.
// ===========================================================================

// One generation at the site. A FRESH service per sample, because the service
// caches by prefix+suffix and every sample after the first would otherwise be a
// cache hit rather than a generation.
//
// The service's own last line rides back with the text. Without it a sample that
// serves nothing reads as "(no ghost)" and the reason - which rule dropped it,
// and what the model had actually written - is gone.
async function ghostAt(prefix, suffix, block) {
  const logs = [];
  const svc = new B.CompletionService(B.DEFAULT_FIM_CONFIG, undefined, (l) => logs.push(l));
  try {
    const result = await svc.complete({
      prefix,
      suffix,
      uri: FIM_URI,
      languageId: "csharp",
      manual: false,
      // Both false at an enum-RHS site, by construction: the provider computes
      // this site only where neither of the other two fired.
      memberSite: false,
      wholeBlockSite: false,
      // And the site itself, which the provider sets whether or not the
      // resolver answers. This is what arms the value gate, in combination with
      // a landed block - so the control arm below is ungated, exactly as it is
      // in the editor when nothing resolved.
      enumRhsSite: true,
      // The arm. Already resolved, so it never loses the 50ms injection race -
      // a cold-resolver miss is goal.md item 4's question, not this leg's.
      ...(block === undefined ? {} : { resolveInjection: async () => block }),
    });
    // The summary line is last and always present; a REFUSAL line sits above it
    // and is the one that names which rule emptied the ghost. Both ride back,
    // because "no ghost" with only the summary is exactly the causality gap the
    // value gate exists to close on this path.
    const dropped = logs.filter((l) => l.startsWith("[fim] dropped:"));
    return {
      text: result?.text,
      why: logs[logs.length - 1] ?? "(no log)",
      dropped,
    };
  } finally {
    svc.dispose();
  }
}

// What the acceptance asks of a ghost: it completes `LodBand.Regional`.
const landsRegional = (text) => /\bLodBand\.Regional\b/.test(text ?? "");
const show = (g) =>
  (g.text === undefined || g.text === "" ? "(no ghost)" : JSON.stringify(g.text)) +
  (g.dropped?.length ? `  [${g.dropped.join(" | ")}]` : "");
const hits = (a) => a.filter((g) => landsRegional(g.text)).length;

gtest(
  "leg 3: at the CAPTURED cursor, WITH the block the ghost completes `LodBand.Regional`, and the control arm is recorded beside it [goal.md item 3 acceptance, second half]",
  { timeout: GHOST_TIMEOUT },
  async (ctx) => {
    const missing = await ollamaMissing();
    if (missing) return ctx.skip(missing);
    if (!state.block) return ctx.skip("the block did not render; see leg 2");

    const arms = { block: [], control: [] };
    // Alternating, so a warming server or a drifting machine hits both arms
    // rather than whichever ran second.
    for (let i = 0; i < SAMPLES; i++) {
      arms.block.push(await ghostAt(CAP.prefix, CAP.suffix, state.block));
      arms.control.push(await ghostAt(CAP.prefix, CAP.suffix, undefined));
    }
    const blockHits = hits(arms.block);
    const controlHits = hits(arms.control);
    state.arms = arms;

    // The whole point of the row: the contrast lives in the test's own evidence,
    // not only in goal.md's log excerpt.
    ctx.diagnostic(`block arm:   ${blockHits}/${SAMPLES} land LodBand.Regional`);
    for (const g of arms.block) {
      ctx.diagnostic(`  block ghost:   ${show(g)}  <- ${g.why}`);
    }
    ctx.diagnostic(`control arm: ${controlHits}/${SAMPLES} land LodBand.Regional`);
    for (const g of arms.control) {
      ctx.diagnostic(`  control ghost: ${show(g)}  <- ${g.why}`);
    }
    // The control arm serves nothing, and "nothing" hides the interesting half:
    // WHAT the model wrote before the bound and the postprocess got to it. Same
    // model, same windows, same temperature, one layer lower - the product's own
    // FIM client, called the way the service calls it, minus the bound's stop.
    // Recorded, never asserted.
    const rawControl = await B.generateFim({
      apiBase: B.DEFAULT_FIM_CONFIG.apiBase,
      model: B.DEFAULT_FIM_CONFIG.model,
      prefix: CAP.prefix.slice(-B.DEFAULT_FIM_CONFIG.prefixChars),
      suffix: CAP.suffix.slice(0, B.DEFAULT_FIM_CONFIG.suffixChars),
      maxTokens: B.DEFAULT_FIM_CONFIG.maxTokens,
      temperature: B.DEFAULT_FIM_CONFIG.temperature,
      signal: new AbortController().signal,
    });
    state.rawControl = rawControl.text;
    ctx.diagnostic(`control arm, RAW first line before any product rule: ${JSON.stringify(rawControl.text.split("\n")[0])}`);

    const evidence =
      `\n  BLOCK:\n${state.block}` +
      `\n  BLOCK ARM (${blockHits}/${SAMPLES}):\n    ${arms.block.map(show).join("\n    ")}` +
      `\n  CONTROL ARM (${controlHits}/${SAMPLES}, asserted on deliberately NOT AT ALL):\n    ${arms.control
        .map(show)
        .join("\n    ")}`;

    // The bar, stated at the top of this file: a strict majority, 3 of 5.
    assert.ok(
      blockHits >= BLOCK_ARM_FLOOR,
      `with the variants in view the ghost must complete \`LodBand.Regional\` in a strict majority of ${SAMPLES} samples (>= ${BLOCK_ARM_FLOOR}); it landed ${blockHits}. The capture this leg exists for wrote \`Band.Regional\`, a value that does not exist.${evidence}`,
    );
    // The one thing the block arm must never do, and the exact text of the
    // captured failure: a bare `Band.Regional` with no type qualifier.
    for (const g of arms.block) {
      if (!landsRegional(g.text)) {
        continue;
      }
      assert.ok(
        !/(?<![A-Za-z0-9_.])Band\.Regional\b/.test(g.text),
        `a landing ghost must not ALSO carry the captured bare \`Band.Regional\`.${evidence}`,
      );
    }
  },
);

// ===========================================================================
// Leg 3b. The SAME block, the SAME model, one keystroke later - AND its control.
//
// RECORDED, NOT ASSERTED, and that is the point: at `t.Band == ` (trailing
// space) the block arm writes `"LodBand.Regional"` - a quoted string, which is
// the right name in a form that cannot compile. The variants are in view and the
// model reaches for the value as text. Asserting it would pin a defect as a
// contract; asserting the opposite would fail a leg the acceptance never asked
// about. So it is measured and printed, and the human decides what it is worth.
//
// This is not the trailing space being an exotic state. It is the very next
// keystroke after the captured one, so the editor hits it on the way through.
//
// The CONTROL runs at the same state for one reason: a wrong block arm proves
// nothing about the block until plain FIM has been asked the same question. If
// the control quotes too, the quoting is the 1.5b's and the leg is not the
// cause; if the control is right where the block is wrong, the block does harm
// one keystroke after it does good.
// ===========================================================================

gtest(
  "leg 3b: RECORDED, one keystroke later (`t.Band == `, trailing space) - the block arm and its control",
  { timeout: GHOST_TIMEOUT },
  async (ctx) => {
    const missing = await ollamaMissing();
    if (missing) return ctx.skip(missing);
    if (!state.block) return ctx.skip("the block did not render; see leg 2");

    const spaced = [];
    const spacedControl = [];
    // Alternating, for the reason leg 3 alternates: a warming server must not
    // land on one arm.
    for (let i = 0; i < SAMPLES; i++) {
      spaced.push(await ghostAt(CAP.spacedPrefix, CAP.spacedSuffix, state.block));
      spacedControl.push(await ghostAt(CAP.spacedPrefix, CAP.spacedSuffix, undefined));
    }
    state.spaced = spaced;
    state.spacedControl = spacedControl;
    const quoted = (a) => a.filter((g) => /"LodBand\./.test(g.text ?? "")).length;
    ctx.diagnostic(
      `spaced BLOCK arm:   ${hits(spaced)}/${SAMPLES} carry LodBand.Regional,` +
        ` ${quoted(spaced)}/${SAMPLES} carry it QUOTED`,
    );
    for (const g of spaced) {
      ctx.diagnostic(`  spaced block ghost:   ${show(g)}  <- ${g.why}`);
    }
    ctx.diagnostic(
      `spaced CONTROL arm: ${hits(spacedControl)}/${SAMPLES} carry LodBand.Regional,` +
        ` ${quoted(spacedControl)}/${SAMPLES} carry it QUOTED`,
    );
    for (const g of spacedControl) {
      ctx.diagnostic(`  spaced control ghost: ${show(g)}  <- ${g.why}`);
    }
    // The product drops most of what plain FIM writes at this site, and "no
    // ghost" hides which text was dropped. The raw line is the comparison the
    // verdict actually rests on.
    const rawSpaced = await B.generateFim({
      apiBase: B.DEFAULT_FIM_CONFIG.apiBase,
      model: B.DEFAULT_FIM_CONFIG.model,
      prefix: CAP.spacedPrefix.slice(-B.DEFAULT_FIM_CONFIG.prefixChars),
      suffix: CAP.spacedSuffix.slice(0, B.DEFAULT_FIM_CONFIG.suffixChars),
      maxTokens: B.DEFAULT_FIM_CONFIG.maxTokens,
      temperature: B.DEFAULT_FIM_CONFIG.temperature,
      signal: new AbortController().signal,
    });
    state.rawSpacedControl = rawSpaced.text;
    ctx.diagnostic(
      `spaced control, RAW first line before any product rule: ${JSON.stringify(rawSpaced.text.split("\n")[0])}`,
    );
    // The only bar here is that both arms ran. Everything else is evidence.
    assert.strictEqual(spaced.length, SAMPLES, "the recorded arm must have produced its samples");
    assert.strictEqual(spacedControl.length, SAMPLES, "and its control must have produced its own");
  },
);

// The acceptance sentence, in one place, so a reader of the run's output can
// see it decided rather than reassemble it from two rows.
gtest(
  "acceptance: at `t.Band == ` the block lists the four variants AND the ghost completes `LodBand.Regional` [goal.md item 3, verbatim]",
  {},
  (ctx) => {
    if (!state.block) return ctx.skip("the block did not render; see leg 2");
    if (!state.arms) return ctx.skip("the ghost arms did not run; see leg 3");
    const lines = state.block.split("\n");
    const listed = ["Municipal", "Regional", "Continental", "Parcel"].filter((v) => lines.includes(`// LodBand.${v}`));
    const blockHits = state.arms.block.filter((g) => landsRegional(g.text)).length;
    ctx.diagnostic(`acceptance: variants listed=${listed.length}/4, ghost lands ${blockHits}/${SAMPLES}`);
    assert.deepStrictEqual(listed, ["Municipal", "Regional", "Continental", "Parcel"], "all four variants are listed");
    assert.ok(blockHits >= BLOCK_ARM_FLOOR, `the ghost completes LodBand.Regional (${blockHits}/${SAMPLES})`);
  },
);
