// IMPLEMENTATION oracle (LIVE) for session-v28 phase 1: capture B, replayed end
// to end against the real Roslyn language server and the real local 30b.
//
// The acceptance bar, the phase goal's item 1 verbatim: at the captured
// `RegionLodCount` site, `tile.Lod == LodBand.Region` under the doc comment "how
// many tiles where LodBand is Region" repairs to `tile.Band == LodBand.Regional`
// in ONE round, with both Tile and LodBand surfaces present in the prompt.
//
// Why live, and why nothing smaller proves it. The defect was never in one pure
// function. It was the KEYING: the repair surface followed the diagnostic's one
// named type per round, so round 1 disclosed LodBand's variants and could not
// know `Band` exists, and round 2's CS0019 disclosed nothing at all and the model
// invented `tile.LodBand`. Both types have to come back from a real cross-project
// resolution (Tile and LodBand live in the Atlas project, the failing span in
// Playground), and the one-round claim is a claim about what THIS model does with
// that surface. A stubbed extractor or a canned reply proves neither half.
//
// The legs, in the order the product runs them:
//   1. spanTypesInPlay over the failing span            -> Tile, LodBand
//   2. resolvePrefill with those as extraCandidates     -> both member blocks
//   3a. round 1: assembleRepairPrompt + generateRaw, fed the diagnostic the
//       compiler REALLY reports for the capture state
//   3b. round 2: round 1's own reply as the failing code, fed the diagnostic
//       the compiler REALLY reports for THAT state
//   4. undisclosedMemberRefusal over both replies       -> no refusal, and the
//      capture's own invention still refused under the same disclosed set
//
// THE FIXTURE IS THE HUMAN'S. `~/repos/csharp-scratch` is a dogfood playground,
// not a test asset. This file writes the capture state into Fim.cs, and restores
// the original bytes unconditionally in test.after and again on process exit. A
// run that leaves the playground modified is a defect in this file.
//
// WHY THE ROUND COUNT MOVED. The first cut of this file fed leg 3 a synthetic
// CS0019 and asserted goal.md's "in ONE round". Then the capture state was
// actually built. `dotnet build` reports exactly one diagnostic for it:
//
//   Fim.cs(13,56): error CS0117: 'LodBand' does not contain a definition for 'Region'
//
// and no CS0019 at all. It cannot report one: with `Region` unresolved the
// operand types are not known, so the operand mismatch is unreachable until the
// variant is fixed. The CS0019 is a round-2 state. goal.md's one-round
// acceptance therefore rests on a diagnostic that does not exist at round 1,
// and no prompt the product can assemble at round 1 carries it. So the legs
// below run the REAL two-round sequence and measure both diagnostics by
// building the file: round 1 is fed the CS0117, its reply is written back into
// the fixture, and round 2 is fed whatever that state really produces. Nothing
// here is a remembered diagnostic; a fixture edit changes every number.
//
// The bar the two rounds are held to is unchanged: the loop must land
// `tile.Band == LodBand.Regional`, never `tile.LodBand`, never `LodBand.Region`,
// and the gate must refuse neither reply.
//
// STATE. Measured first over 10 consecutive runs against the fixed enum surface
// (leg 2 green, both blocks rendering, `Band` and `Regional` both in the
// prompt):
//
//   * round 1, 10/10, fixes the variant and nothing else:
//       return tiles.Count(tile => tile.Lod == LodBand.Regional);
//     In 1 of those 10 it went further and landed `tile.Band` too, so the
//     one-round outcome is reachable but not the rule at temperature 0.2.
//   * round 2, in every run that reached it, replied with its INPUT, byte for
//     byte. Given the CS0019 naming both operand types, Tile's block carrying
//     `Band : LodBand`, and the firm instruction, the model still changed
//     nothing. Whitespace-normalized that is isNoOpRepair, so the product's own
//     loop logged `round 2 made no meaningful change; not proposed` and the
//     human was left with the CS0019 - a repaired variant, an unrepaired member.
//
// That made leg 3b red, and it was a product finding, not a test bug:
// disclosure is necessary and NOT sufficient. The surface said what EXISTS; it
// never said which member answers the type the compiler named. The product now
// closes that with the operand steer (`membersOfType` in repairGate.ts, injected
// by oracleSurface.ts), and the round assembly below carries it. The A/B that
// justifies it is recorded above leg 3b, where its bar lives.
//
// Gated: NOT registered in package.json test:live. A frozen blind test pins
// that list by exact equality, and the blind set is never edited to make
// something pass; whether this file joins the contract is the human's call.
// Skips (never fails) without the Roslyn DLL, dotnet, the fixture, or ollama;
// SKIP_LIVE=1 skips the whole file.
// Run: node --test --test-concurrency=1 test/impl-v28-p1-repair-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { execFileSync } = require("child_process");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
// The 30b is slow cold, and a Roslyn cross-project load is slower still.
const MODEL_TIMEOUT = 300_000;
const LSP_TIMEOUT = 300_000;
// A round measures its own diagnostic with a real build before it calls the
// model, so a round's budget is a build plus a generation.
const BUILD_TIMEOUT = 240_000;
const ROUND_TIMEOUT = MODEL_TIMEOUT + BUILD_TIMEOUT;

const API_BASE = "http://localhost:11434";
const MODEL = "qwen3-coder:30b";
// The reference carve, same literal every other live suite uses.
const LIVE_CONFIG = {
  apiBase: API_BASE,
  model: MODEL,
  fallbackModel: "qwen2.5-coder:14b-instruct-q4_K_M",
  maxTokens: 512,
  temperature: 0.2,
  numGpu: 30,
};

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll",
);
const REPO = "/home/utilitydelta/repos/csharp-scratch";
const PLAYGROUND_CSPROJ = path.join(REPO, "src/Playground/Playground.csproj");
const ATLAS_CSPROJ = path.join(REPO, "src/Atlas/Atlas.csproj");
const FIM_CS = path.join(REPO, "src/Playground/Fim.cs");
const FIM_URI = pathToFileURL(FIM_CS).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===========================================================================
// The bundle. One entry for the whole path: the pre-fill engine needs the
// vscode alias, the four core modules do not care, and bundling them together
// keeps a single build failure instead of two.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v28-p1-live-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const fs = require("fs");
const { fileURLToPath } = require("node:url");
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    // The def files are REAL files on disk (Atlas.cs, in a sibling project), so
    // the stub serves them from disk. A map fixture here would resolve the
    // cross-project walk against text nobody compiled.
    openTextDocument: (arg) => {
      const key = keyOf(arg);
      let text;
      try { text = fs.readFileSync(key.startsWith("file:") ? fileURLToPath(key) : key, "utf8"); }
      catch { text = undefined; }
      return text === undefined
        ? Promise.reject(new Error("no such document: " + key))
        : Promise.resolve({ uri: mkUri(key), getText: () => text });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v28-p1-live.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v28-p1-live.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";
export { CsLspExtractor } from "../src/core/csLspExtractor";
export { spanTypesInPlay } from "../src/core/repairTypes";
export { undisclosedMemberRefusal, membersOfType } from "../src/core/repairGate";
export { assembleRepairPrompt } from "../src/core/repair";
export { firmInstructionFor, classifyCsHallucination } from "../src/core/compilerDirected";
export { FnGenService } from "../src/core/fnGenService";
export { listModels } from "../src/core/ollama";
export { CsOracle } from "../src/core/csOracle";
export { reindentCsBody } from "../src/core/csExtraction";\n`,
  );
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);

// ===========================================================================
// The capture, written into the human's playground and taken back out again.
// ===========================================================================

// goal.md capture B, byte for byte. Two faults in one span, which is the whole
// point: `Region` is not a variant of LodBand (Continental/Regional/Municipal/
// Parcel are), and `Lod` is Tile's int property while `Band` is the LodBand one.
// Fixing it needs BOTH types disclosed at once. That is exactly what the old
// diagnostic-keyed surface could never do.
const CAPTURE = `    /// <summary>
    /// how many tiles where LodBand is Region
    /// </summary>
    public static int RegionLodCount(List<Tile> tiles)
    {
        return tiles.Count(tile => tile.Lod == LodBand.Region);
    }`;

const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;
let dotnetMissing;
try {
  execFileSync("dotnet", ["--version"], { timeout: 60000, stdio: "ignore" });
} catch (e) {
  dotnetMissing = `dotnet is not runnable on PATH: ${e.message}`;
}
const fixtureMissing = !fs.existsSync(FIM_CS) ? `csharp-scratch fixture not found at ${FIM_CS}` : undefined;

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

// Replace the RegionLodCount method (declaration line plus the `///` block above
// it, plus the brace-matched body) with the capture. Locating it by its
// declaration rather than by line numbers is what keeps this working when the
// human edits the rest of the playground.
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
  fs.writeFileSync(FIM_CS, next, "utf8");
  armed = true;

  // The resolution record the product would have built, off the written text.
  // The span starts at the declaration head so the doc comment stays OUTSIDE it,
  // which is the ResolvedFunction contract.
  const declAt = next.indexOf("public static int RegionLodCount");
  const bodyOpen = next.indexOf("{", declAt);
  let d = 0;
  let spanEnd = -1;
  for (let i = bodyOpen; i < next.length; i++) {
    if (next[i] === "{") d++;
    else if (next[i] === "}") {
      d--;
      if (d === 0) {
        spanEnd = i + 1;
        break;
      }
    }
  }
  const docStart = next.lastIndexOf("/// <summary>", declAt);
  const docEnd = next.lastIndexOf("\n", declAt) + 1;
  CAP = {
    text: next,
    span: { start: declAt, end: spanEnd },
    code: next.slice(declAt, spanEnd),
    signature: "public static int RegionLodCount(List<Tile> tiles)",
    docComment: next.slice(docStart, docEnd).replace(/\s+$/, ""),
  };
  // No diagnostic is written here. Every diagnostic this file feeds a round is
  // MEASURED off a real `dotnet build` of the state that round is repairing.
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
// human's playground carrying a broken method.
process.on("exit", restoreFixture);

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  restoreFixture();
  for (const f of [STUB, ENTRY, OUTFILE]) {
    fs.rmSync(f, { force: true });
  }
});

// ===========================================================================
// Harness.
// ===========================================================================

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr, fsPath: fileURLToPath(uriStr) },
    languageId: "csharp",
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

let restoredNuget = false;
function ensureRestore() {
  if (!restoredNuget) {
    execFileSync("dotnet", ["restore", PLAYGROUND_CSPROJ], { cwd: REPO, timeout: 180000, stdio: "ignore" });
    restoredNuget = true;
  }
}

// ===========================================================================
// The diagnostics each round is fed. MEASURED, never written down: the state
// goes on disk, the product's own C# oracle builds it and parses its own SARIF,
// and whatever comes back is what the round sees. The alternative - a literal
// diagnostic in this file - is exactly how the first cut of this test came to
// assert a one-round repair against a CS0019 the compiler never emits at
// round 1.
// ===========================================================================

let csOracleP;
const csOracle = () => (csOracleP ||= new B.CsOracle());
const CRATE_ROOT = path.dirname(PLAYGROUND_CSPROJ);

/** Write `text` into the fixture, build it, and return the error diagnostics
 *  whose primary span lands in that file. Also returns the raw console text so
 *  a surprising parse can be read against what dotnet actually printed. */
function measureDiagnostics(text) {
  ensureRestore();
  fs.writeFileSync(FIM_CS, text, "utf8");
  const cmd = csOracle().buildCheckCommand(CRATE_ROOT);
  let console_ = "";
  try {
    console_ = execFileSync(cmd.command, cmd.args, {
      cwd: cmd.cwd,
      env: { ...process.env, ...(cmd.env ?? {}) },
      timeout: BUILD_TIMEOUT,
      encoding: "utf8",
    });
  } catch (e) {
    // A failing build exits non-zero; that is the normal path here. The
    // diagnostics ride the out-of-band SARIF either way.
    console_ = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const all = csOracle().parseCheckOutput("", CRATE_ROOT);
  const errors = all.filter((d) => d.level === "error" && d.spans.some((s) => s.isPrimary && s.fileName === FIM_CS));
  return { errors, all, console: console_ };
}

/** One diagnostic in the form the failure messages print it: the exact text the
 *  round was given, plus the geometry it was given it at. */
const showDiag = (d) =>
  `${d.code ?? "?"} ${JSON.stringify(d.message)} @ ${d.spans
    .map((s) => `${path.basename(s.fileName)}(${s.lineStart},${s.columnStart})-(${s.lineEnd},${s.columnEnd}) bytes ${s.byteStart}..${s.byteEnd}`)
    .join(" ")}`;
const showDiags = (ds) => (ds.length === 0 ? "(none)" : ds.map(showDiag).join("\n           "));

let exP;
const extractor = () =>
  (exP ||= (async () => {
    ensureRestore();
    // BOTH projects: Tile and LodBand are defined in Atlas, the failing span
    // lives in Playground. A single-project load is the shape that cannot
    // resolve the capture at all.
    const ex = await B.CsLspExtractor.start({
      projectRoot: REPO,
      csproj: [pathToFileURL(PLAYGROUND_CSPROJ).href, pathToFileURL(ATLAS_CSPROJ).href],
      serverDll: ROSLYN_DLL,
    });
    await ex.whenReady();
    return ex;
  })());

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

// What each leg hands the next one. Shared across rows so each round is asked
// exactly once and every later leg judges the SAME reply.
const state = {};

test("bundle guard: the phase-1 repair path builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of [
    "resolvePrefill",
    "CsLspExtractor",
    "spanTypesInPlay",
    "undisclosedMemberRefusal",
    "membersOfType",
    "assembleRepairPrompt",
    "firmInstructionFor",
    "classifyCsHallucination",
    "FnGenService",
    "listModels",
    "CsOracle",
    "reindentCsBody",
  ]) {
    assert.ok(B[n] !== undefined, `${n} must be exported`);
  }
});

// ===========================================================================
// Leg 1. The span names the types, not the diagnostic. Pure, no server.
// ===========================================================================

gtest(
  "leg 1: the failing span's types-in-play are Tile AND LodBand [goal.md item 1: 'the repair surface follows the diagnostic's named type one round at a time, never the span's types-in-play']",
  {},
  () => {
    const types = B.spanTypesInPlay({
      languageId: "csharp",
      signature: CAP.signature,
      docComment: CAP.docComment,
      code: CAP.code,
      // What a CS0019 names. Last in the order, and neither type comes from it:
      // Tile is the signature's, LodBand is the body's.
      diagnosticTypes: ["int", "LodBand"],
    });
    state.spanTypes = types;
    for (const t of ["Tile", "LodBand"]) {
      assert.ok(
        types.includes(t),
        `the span's types-in-play must carry \`${t}\`; a repair that cannot see both cannot write \`tile.Band == LodBand.Regional\`. got ${JSON.stringify(types)}`,
      );
    }
    assert.ok(!types.includes("int"), `\`int\` is a std name and must not be resolved as a type, got ${JSON.stringify(types)}`);
  },
);

// ===========================================================================
// Leg 2. Both surfaces really render, against the real server.
// ===========================================================================

gtest(
  "leg 2: the span surface discloses BOTH Tile and LodBand, carrying `Band` and the real variant `Regional` [goal.md acceptance: 'with both Tile and LodBand surfaces present in the prompt']",
  { timeout: LSP_TIMEOUT },
  async () => {
    const ex = await extractor();
    const resolved = {
      span: CAP.span,
      signature: CAP.signature,
      docComment: CAP.docComment,
      symbolName: "RegionLodCount",
      languageId: "csharp",
      kind: "function",
      bodyOnly: false,
      headerIndent: "    ",
      bodyIndent: "",
      docstringRefusal: undefined,
    };
    const doc = makeDoc(CAP.text, FIM_URI);
    const logs = [];
    const disclosed = [];
    let surface;
    // Roslyn answers definition/documentSymbol only once the cross-project load
    // has settled; bounded retries absorb that without masking a real hole. The
    // LAST attempt is what the assertions read, so a permanent miss is reported
    // as the surface it actually produced.
    for (let attempt = 0; attempt < 12; attempt++) {
      logs.length = 0;
      disclosed.length = 0;
      surface = await B.resolvePrefill(ex, doc, resolved, (l) => logs.push(l), {
        extraCandidates: state.spanTypes ?? ["Tile", "LodBand"],
        omitInstruction: true,
        onDisclosed: (types) => disclosed.push(...types),
      });
      // Both BLOCKS, not both words: `LodBand` also appears inside Tile's block
      // as the type of `Band`, and settling on that would report a cold-start
      // race as a resolved surface.
      if (surface && surface.includes("Members of `Tile`") && surface.includes("Members of `LodBand`")) {
        break;
      }
      await sleep(1000);
    }
    state.surface = surface;
    state.disclosed = disclosed.slice();
    state.prefillLogs = logs.slice();
    const dump = `\n  LOGS: ${JSON.stringify(logs, null, 1)}\n  SURFACE:\n${surface}`;

    assert.ok(surface, `the span surface must resolve; nothing rendered.${dump}`);
    for (const t of ["Tile", "LodBand"]) {
      assert.ok(surface.includes(`\`${t}\``), `the surface must name \`${t}\`.${dump}`);
    }
    // The two members the capture's fix is made of. `Band` is what capture B
    // round 1 could not see, `Regional` is what round 2 could not see. If either
    // is missing here the surface is a hole, not a test bug.
    assert.match(
      surface,
      /\bBand\b/,
      `the Tile surface must carry the real member \`Band\`; without it the model cannot write the human's intent.${dump}`,
    );
    assert.match(
      surface,
      /\bRegional\b/,
      `the LodBand surface must list its variants (Regional is the one the doc comment means).${dump}`,
    );
    const names = disclosed.map((d) => d.name);
    for (const t of ["Tile", "LodBand"]) {
      assert.ok(
        names.includes(t),
        `onDisclosed must report \`${t}\`: the gate may only refuse on what it was told rendered. got ${JSON.stringify(disclosed)}${dump}`,
      );
    }
  },
);

// ===========================================================================
// Leg 3. The real rounds, real model, real prompt, measured diagnostics.
// ===========================================================================

// One repair round exactly as src/vscode/oracleSurface.ts assembles it: the
// span surface bare, then the operand-mismatch steer lines, closed by ONE firm
// instruction naming every disclosed type, then the failing code, then the
// diagnostics. An instruction scoped to one type while another type's block
// sits above it is capture A's exact failure mode, so the assembly is shared
// between the rounds rather than re-typed per leg.
//
// The steer is derived here the way the product derives it and not written
// down: the round's own diagnostics are classified, each operand type is asked
// of the disclosed graph, and a type nothing in scope answers contributes no
// line. Round 1's CS0117 is not an operand mismatch, so round 1 carries no
// steer - which is the product's behaviour too, not a simplification.
async function repairRound(code, diagnostics) {
  const operandTypes = [];
  for (const d of diagnostics) {
    const cls = B.classifyCsHallucination(d);
    if (cls?.kind === "operand-mismatch") {
      for (const t of cls.types) {
        if (!operandTypes.includes(t)) {
          operandTypes.push(t);
        }
      }
    }
  }
  const steers = [];
  for (const t of operandTypes) {
    const answering = B.membersOfType(state.disclosed, t);
    if (answering.length > 0) {
      steers.push(`Members in scope whose type is \`${t}\`: ${answering.join(", ")}.`);
    }
  }
  const surface = `${[state.surface, ...steers].join("\n\n")}\n\n${B.firmInstructionFor(state.disclosed.map((d) => d.name))}`;
  const prompt = B.assembleRepairPrompt({
    languageId: "csharp",
    docComment: CAP.docComment,
    code,
    diagnostics,
    surface,
    kind: "function",
  });
  const lines = [];
  const svc = new B.FnGenService(LIVE_CONFIG, undefined, (l) => lines.push(l));
  let result;
  try {
    result = await svc.generateRaw(prompt, {
      docComment: CAP.docComment,
      signature: CAP.signature,
      span: CAP.span,
    });
  } finally {
    svc.dispose();
  }
  return { prompt, result, lines, steers };
}

// The three member-level bars, applied to whichever reply ends the loop. Each
// prints the reply: a live failure that does not say what the model said cannot
// be analysed after the fact.
function assertLandsBand(reply, label, context = "") {
  const flat = reply.replace(/\s+/g, " ");
  const said = `${context}\n  REPLY (${label}):\n${reply}`;
  assert.match(flat, /LodBand\.Regional\b/, `${label} must name the REAL variant \`LodBand.Regional\`.${said}`);
  assert.ok(
    !/LodBand\.Region\b/.test(flat),
    `${label} must not keep the invented variant \`LodBand.Region\`; the surface listed the real four.${said}`,
  );
  assert.ok(
    /\bBand\s*==\s*LodBand\.Regional\b/.test(flat) || /\bLodBand\.Regional\s*==\s*[A-Za-z_][A-Za-z0-9_]*\.Band\b/.test(flat),
    `${label} must read the \`Band\` member (\`tile.Band == LodBand.Regional\`), which is the human's intent in their own doc comment.${said}`,
  );
  // The cast is included on purpose. Measured in the no-steer arm 4 times in 5:
  // `tile.Lod == (int)LodBand.Regional` silences CS0019 and builds clean, so the
  // compiler cannot reject it - and it still counts the wrong tiles, because
  // `Lod` is not the band. A bar that only watched the compiler would call that
  // a repair.
  assert.ok(
    !/\.\s*Lod\s*==\s*(\([A-Za-z_][A-Za-z0-9_]*\)\s*)?LodBand\./.test(flat) &&
      !/LodBand\.[A-Za-z]+\s*==\s*(\([A-Za-z_][A-Za-z0-9_]*\)\s*)?[A-Za-z_][A-Za-z0-9_]*\.Lod\b/.test(flat),
    `${label} must not read the int property \`Lod\`; comparing it to a LodBand is the CS0019 the loop exists to fix, and casting it away builds clean while still counting the wrong tiles.${said}`,
  );
  assert.ok(
    !/\b[a-z][A-Za-z0-9_]*\s*\.\s*LodBand\b/.test(flat),
    `${label} must not invent \`tile.LodBand\`: a type is not a member of a value, and that invention is what survived the round cap in the capture.${said}`,
  );
}

gtest(
  "leg 3a: round 1, fed the diagnostic the compiler REALLY reports for the capture (CS0117 on `Region`), fixes the variant [goal.md capture B round 1]",
  { timeout: ROUND_TIMEOUT },
  async (ctx) => {
    const missing = await ollamaMissing();
    if (missing) return ctx.skip(missing);
    if (!state.surface) return ctx.skip("the span surface did not resolve; see leg 2");

    // Measured, not remembered. The capture state is on disk already; build it
    // and take the compiler at its word about what round 1 can possibly see.
    const measured = measureDiagnostics(CAP.text);
    state.round1Diagnostics = measured.errors;
    const given = `\n  DIAGNOSTICS GIVEN:\n           ${showDiags(measured.errors)}`;
    // A live leg reports its evidence on the way past, green or red. What the
    // compiler said and what the model said are the whole value of this run;
    // reading them only out of a failure message means a green run teaches
    // nothing.
    ctx.diagnostic(`round 1 diagnostics: ${showDiags(measured.errors)}`);
    assert.ok(
      measured.errors.length > 0,
      `the capture state must not build clean; there would be no round at all.\n  ALL DIAGNOSTICS: ${showDiags(measured.all)}\n  CONSOLE:\n${measured.console}`,
    );
    // The state check, not a bar on the model: if the compiler ever stops
    // reporting this, every number below moved and the legs must be re-read.
    assert.ok(
      measured.errors.some((d) => d.code === "CS0117" && /'LodBand' does not contain a definition for 'Region'/.test(d.message)),
      `round 1's real diagnostic is the unresolved variant, and nothing else can be reported while it is unresolved.${given}\n  CONSOLE:\n${measured.console}`,
    );

    const { prompt, result } = await repairRound(CAP.code, measured.errors);
    state.round1Prompt = prompt;
    assert.ok(
      result && typeof result.text === "string" && result.text.length > 0,
      `round 1 must produce a reply, got ${JSON.stringify(result)}${given}`,
    );
    state.reply1 = result.text;
    ctx.diagnostic(`round 1 reply:\n${result.text}`);
    const flat = result.text.replace(/\s+/g, " ");
    const said = `${given}\n  REPLY (round 1):\n${result.text}`;

    assert.match(flat, /LodBand\.Regional\b/, `round 1 must name the REAL variant \`LodBand.Regional\`; the surface listed the real four.${said}`);
    assert.ok(
      !/LodBand\.Region\b/.test(flat),
      `round 1 must not keep the invented variant \`LodBand.Region\`: that variant is the whole content of the diagnostic it was given.${said}`,
    );
  },
);

// THE BAR'S HISTORY. This leg was red, and the bar did not move; the prompt did.
// Measured A/B at ONE frozen round-2 state (round 1's real reply spliced in, the
// real CS0019, the same span surface and firm instruction), N=5 per arm,
// alternating A,B so warm-server drift hits both:
//
//   arm A, no steer:   0/5 read `Band`. 1 returned its input byte for byte; the
//                      other 4 silenced the compiler with a cast,
//                      `tile.Lod == (int)LodBand.Regional` - green build, wrong
//                      answer, and the human's doc comment still unserved.
//   arm B, with steer: 5/5 `tile.Band == LodBand.Regional`, identical replies,
//                      no invention, no refusal from the gate.
//
// So the round-2 no-op is not a ceiling on the model: it could not pick the
// member because nothing told it which member answers the type the compiler
// named. This leg now runs arm B, which is what the product ships.
gtest(
  "leg 3b: round 2, fed round 1's OWN reply and the diagnostic THAT state really reports, lands `tile.Band == LodBand.Regional` [goal.md acceptance, one round later than goal.md claims]",
  { timeout: ROUND_TIMEOUT },
  async (ctx) => {
    const missing = await ollamaMissing();
    if (missing) return ctx.skip(missing);
    if (!state.reply1) return ctx.skip("round 1 produced no reply; see leg 3a");

    // What the loop does after a round: re-indent the reply and splice it over
    // the same span, then re-check. The span excludes the doc comment (the
    // ResolvedFunction contract), so a reply that repeated the doc would double
    // it; drop those lines and repair the same text the document would hold.
    const reindented = B.reindentCsBody(state.reply1, "    ");
    const round1Code = reindented.replace(/^(\s*\/\/\/.*\n)+/, "");
    assert.match(
      round1Code,
      /\bRegionLodCount\s*\(/,
      `round 1's reply must be a whole function definition to splice over the span; it is what the round asked for.\n  REPLY (round 1):\n${state.reply1}`,
    );
    const spliced = CAP.text.slice(0, CAP.span.start) + round1Code + CAP.text.slice(CAP.span.end);
    const measured = measureDiagnostics(spliced);
    // Back to the capture state on disk: nothing after this leg should read a
    // fixture holding a half-repaired method.
    fs.writeFileSync(FIM_CS, CAP.text, "utf8");
    state.round2Diagnostics = measured.errors;
    const given = `\n  ROUND 2 CODE:\n${round1Code}\n  DIAGNOSTICS GIVEN:\n           ${showDiags(measured.errors)}`;
    ctx.diagnostic(`round 1's reply as spliced:\n${round1Code}`);
    ctx.diagnostic(`round 2 diagnostics: ${showDiags(measured.errors)}`);

    if (measured.errors.length === 0) {
      // Round 1 ended the loop. Then the one-round bar is met and it is round
      // 1's reply that has to carry the human's intent.
      ctx.diagnostic("round 1's reply builds clean: the loop stopped at one round and there is no round 2 to run");
      assertLandsBand(state.reply1, "round 1 (which built clean, so the loop stopped there)");
      state.replyFinal = state.reply1;
      return;
    }
    // The operand mismatch only becomes reportable once the variant resolves,
    // which is the whole reason this is round 2 and not round 1.
    assert.ok(
      measured.errors.some((d) => d.code === "CS0019"),
      `with the variant fixed, the state round 2 repairs is the operand mismatch; anything else means round 1 changed something this leg does not model.${given}\n  CONSOLE:\n${measured.console}`,
    );

    const { prompt, result, steers } = await repairRound(round1Code, measured.errors);
    state.round2Prompt = prompt;
    state.round2Steers = steers;
    // The steer is the difference between this leg's two measured arms, so a run
    // that reports the reply without reporting the steer cannot be read later.
    ctx.diagnostic(`round 2 operand steer: ${steers.length === 0 ? "(none)" : steers.join(" ")}`);
    assert.ok(
      steers.length > 0,
      `round 2's CS0019 must carry an operand steer; without it the measured arm is arm A, which lands \`Band\` 0 times in 5.${given}`,
    );
    assert.ok(
      result && typeof result.text === "string" && result.text.length > 0,
      `round 2 must produce a reply, got ${JSON.stringify(result)}${given}`,
    );
    state.reply2 = result.text;
    state.replyFinal = result.text;
    ctx.diagnostic(`round 2 reply:\n${result.text}`);
    assertLandsBand(result.text, "round 2", given);
  },
);

// ===========================================================================
// Leg 4. The gate agrees with the compiler-correct repair, and still refuses
// the capture's own invention on the same evidence.
// ===========================================================================

gtest(
  "leg 4: the disclosed-surface gate refuses NEITHER round's reply [design-p1: 'a refusal leaves the human exactly where the round started']",
  {},
  (ctx) => {
    if (!state.reply1) return ctx.skip("no model reply; see leg 3a");
    // Both rounds face the gate in the product, not just the last one: a
    // refusal at round 1 ends the session and round 2 never happens.
    const rounds = [["round 1", state.reply1]];
    if (state.reply2) {
      rounds.push(["round 2", state.reply2]);
    }
    const disclosed = JSON.stringify(state.disclosed.map((d) => ({ name: d.name, complete: d.complete, members: d.members })));
    for (const [label, reply] of rounds) {
      const refusal = B.undisclosedMemberRefusal(reply, state.disclosed);
      assert.strictEqual(
        refusal,
        undefined,
        `a repair that names only disclosed members must pass the gate; refusing it costs the human a round for nothing.\n  REFUSAL (${label}): ${refusal}\n  DISCLOSED: ${disclosed}\n  REPLY (${label}):\n${reply}`,
      );
    }
  },
);

gtest(
  "leg 4b: the same gate DOES refuse the capture's own invention `tile.LodBand` [goal.md capture B round 2]",
  {},
  (ctx) => {
    if (!state.disclosed || state.disclosed.length === 0) return ctx.skip("no disclosed surface; see leg 2");
    // The text the model actually produced in the capture, under the same
    // disclosed set the correct repair passed on. Same evidence, opposite
    // verdict: that is what makes the gate a gate and not a mood.
    const invented = "return tiles.Count(tile => tile.LodBand == LodBand.Regional);";
    const refusal = B.undisclosedMemberRefusal(invented, state.disclosed);
    assert.ok(
      refusal !== undefined,
      `\`tile.LodBand\` names the disclosed TYPE as a member of a value and must be refused.\n  DISCLOSED: ${JSON.stringify(state.disclosed.map((d) => ({ name: d.name, complete: d.complete, members: d.members })))}`,
    );
    assert.match(refusal, /LodBand/, `the refusal reason must name what it caught, got ${JSON.stringify(refusal)}`);
  },
);
