// Blind oracle: v9 phase 4B - repair side + oracle honesty for TypeScript
// (session-v9/phase4-surface.md: "Iron constraints", "Predicted breakage",
// "4B contract", "4B amendments"). Black-box: never reads src/**. Written
// BEFORE the 4B implementation exists; every red maps to an unbuilt 4B
// behavior, every green is a freeze pin on behavior that must survive 4B.
//
// Two harness layers, both established blind conventions:
//   A. HEADLESS: resolveSurfaceInjection bundled with the minimal vscode stub
//      (the blind-v6-item1 / blind-v7-repair-xfile pattern), plus TsOracle /
//      oracleFor / runOracleCheck from the core bundle (the blind-v9-tsoracle
//      pattern). TS diagnostics are REAL: a scratch project is scaffolded at
//      run time, the repo's own typescript (node_modules/typescript) is run
//      over it once, and the captured stdout is parsed through the shipped
//      TsOracle.parseCheckOutput - so every code/message/span under test is
//      the real tsc shape, never hand-derived.
//   B. EXTENSION: the whole extension activated against a widened vscode stub
//      with a fake in-process Ollama (the blind-v9-gestures pattern), plus
//      captures for every verdict surface (toasts, status bar, decorations,
//      shown documents) and for edit application (workspace.applyEdit /
//      editor.edit) - the observation points for the qualify consent gate and
//      the 4B-amendment env surfacing.
//
// Contract pinned (4B):
//  1. TS hallucination classifier routing through the repair-injection path:
//     TS2339/TS2551 inject a signatures-first member surface for the quoted
//     receiver (member set via completeMembers at the error site); TS2304/
//     TS2552 belong to the qualify class (never the example leg); TS2305/
//     TS2724 get the wrong-item treatment (a payload naming the quoted item);
//     everything else (TS2322, TS2307) injects NOTHING - honest restraint.
//     Example legs are NEVER consulted for TS (no example dispatch, ever).
//  2. Field-shape honesty: a field-class diagnostic whose receiver type
//     resolves through the TS hooks renders the type's REAL fields; name-only
//     members render as bare names (no invented types); a TS enum hover must
//     NOT be parsed by the Rust struct/enum machinery (enum-shaped output,
//     never rust-struct-shaped).
//  3. Qualify for TS: a real-project TS2304 whose extractor qualifyImport
//     resolves a single import edit routes through the presenter consent gate
//     - the exact edit is SHOWN on an observable surface, never silently
//     applied (the edit range is outside the accepted span). Ambiguity (two
//     providers) => no qualify offer.
//  4. Coverage fallback (4B amendments): a vite-style solution shell
//     (files:[] + references) resolves a REAL check verdict end to end; a
//     sibling tsconfig.server.json exclusively covering server/** resolves a
//     real verdict; a file covered by NOTHING keeps the honest-dark skip with
//     its evidence line. Real repo typescript, real spawns.
//  5. Autosave guard: a target file whose mtime is newer than the check start
//     parses to the -1 sentinel offsets plus the channel line
//     `content changed since check; offsets skipped`.
//  6. Env surfacing: an EXPLICIT gesture (column80.repairFunction) whose
//     oracle half cannot run states the one-line reason on the toast/verdict
//     surface: no tsconfig above the file; no typescript resolvable (names
//     the roots walked); project tsc crashed (first stderr line); file not an
//     input of any probed config. FIM and fn-gen stay silent (channel only).
//
// Layout bytes of TS payloads are NOT pinned (TS constants are new and free);
// only content presence, honesty, and the named channel/toast lines.
//
// Run: SKIP_LIVE=1 node --test test/blind-v9-repair.test.cjs
// (Hermetic: the "server" is in-process; tsc spawns use the repo's own
// node_modules/typescript - local, no network, no model.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("node:http");
const esbuild = require("esbuild");
const { spawn, spawnSync } = require("node:child_process");

const REPO_TS_DIR = path.join(__dirname, "..", "node_modules", "typescript");
const TSC_BIN = path.join(REPO_TS_DIR, "bin", "tsc");

// ===========================================================================
// Layer A: headless bundle. resolveSurfaceInjection needs the minimal vscode
// stub alias (blind-v6-item1 precedent); the core exports ride the same
// bundle so the SAME TsOracle parse feeds the SAME injection surface.
// ===========================================================================

const STUB_A = path.join(__dirname, ".blind-v9-repair-min-stub.cjs");
fs.writeFileSync(
  STUB_A,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`
);
const entryA = path.join(__dirname, ".blind-v9-repair.entry.ts");
const outA = path.join(__dirname, ".blind-v9-repair.bundle.cjs");
let modA = {};
let bundleErrorA;
try {
  fs.writeFileSync(
    entryA,
    `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { TsOracle, oracleFor, runOracleCheck } from "../src/core/compilerOracle";\n`
  );
  esbuild.buildSync({ entryPoints: [entryA], bundle: true, outfile: outA, format: "cjs", platform: "node", alias: { vscode: STUB_A } });
  modA = require(outA);
} catch (e) {
  bundleErrorA = e;
}
for (const name of ["resolveSurfaceInjection", "TsOracle", "runOracleCheck"]) {
  if (!bundleErrorA && typeof modA[name] !== "function") {
    bundleErrorA = new Error(`the bundle built but exports no ${name}`);
  }
}
const { resolveSurfaceInjection, TsOracle, runOracleCheck } = modA;

test("bundle A: the repair-injection + oracle surface builds [harness guard]", () => {
  if (bundleErrorA) assert.fail(`the surface is not buildable: ${bundleErrorA.message}`);
});

const gtestA = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErrorA) return ctx.skip("headless bundle failed; see the bundle A test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Shared small helpers.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);

const writeTree = (root, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
};

// A document fake over a text string, carrying the languageId the per-language
// seams dispatch on (the blind-v6/v7 makeDoc, widened for TS).
function makeHeadlessDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    uri: { toString: () => uriStr, fsPath: uriStr.replace(/^file:\/\//, ""), scheme: "file" },
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAtText = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

// A recording SurfaceExtractor fake. Every primitive records its calls;
// answers come from the per-test table (value or function). example carries a
// TRAP answer by default: the TS contract says the example leg is NEVER
// dispatched, so if it ever is, both the call count and the payload catch it.
const EXAMPLE_TRAP = "EXAMPLE_TRAP_SENTINEL";
function recordingExtractor(answers = {}) {
  const calls = { example: [], completeMembers: [], hoverSurface: [], membersOfType: [], definition: [], qualifyImport: [] };
  const mk = (name, fallback) => async (...a) => {
    calls[name].push(a);
    const h = answers[name];
    if (h === undefined) return fallback;
    return typeof h === "function" ? h(...a) : h;
  };
  return {
    calls,
    example: mk("example", EXAMPLE_TRAP),
    completeMembers: mk("completeMembers", []),
    hoverSurface: mk("hoverSurface", undefined),
    membersOfType: mk("membersOfType", []),
    definition: mk("definition", undefined),
    qualifyImport: mk("qualifyImport", undefined),
  };
}

const assertNoExampleDispatch = (ext, payload) => {
  assert.strictEqual(ext.calls.example.length, 0, "example legs are dark for TS by contract: NO example dispatch, ever");
  if (payload) assert.ok(!payload.includes(EXAMPLE_TRAP), `no example content may reach a TS payload; got: ${payload}`);
};

// A real spawner in the CheckCommand shape (env merged over process.env, the
// phase 2 amendment); records every command it runs.
const realRunCommand = (record) => (cmd) =>
  new Promise((resolve, reject) => {
    if (record) record.push(cmd);
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...process.env, ...(cmd.env || {}) } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code === null ? -1 : code }));
  });

const isProbe = (cmd) => cmd.args.includes("--listFilesOnly");

// ---------------------------------------------------------------------------
// The classifier fixture project: one file per TS code, REAL tsc run once,
// stdout parsed through the shipped TsOracle so the diagnostics under test
// are exactly what a live check would deliver. [surface: '4B contract - TS
// hallucination classifier' + phase2 'Fixtures' discipline]
// ---------------------------------------------------------------------------

const ORDER_TS = "export type Order = { reference: string; placedBy: string };\n";
const A2339_TS = 'import { Order } from "./order";\nconst o: Order = { reference: "r", placedBy: "c" };\nexport const town = o.city;\n';
const A2551_TS = "export class ThemeStore {\n  setTheme(theme: string): void {\n    void theme;\n  }\n}\nconst store = new ThemeStore();\nstore.setTeme(\"dark\");\n";
const A2304_TS = "export function useSole(): number {\n  return soleExport + 1;\n}\n";
const A2552_TS = "const themeStore = 1;\nexport const w = themeStor + 1;\n";
const A2305_TS = 'import { missingThing } from "./order";\nexport const m = missingThing;\n';
const A2724_TS = 'import { Orderr } from "./order";\nexport const q: Orderr = { reference: "r", placedBy: "c" };\n';
const A2322_TS = 'export const n: number = "x";\n';
const A2307_TS = 'import { helper } from "./missing";\nexport const v = helper;\n';
const ENUM_TS = "export enum ColorMode {\n  Dark,\n  Light,\n}\nexport function label(mode: ColorMode): string {\n  return mode.brighten;\n}\n";

const CLSFX_FILES = {
  "src/order.ts": ORDER_TS,
  "src/a2339.ts": A2339_TS,
  "src/a2551.ts": A2551_TS,
  "src/a2304.ts": A2304_TS,
  "src/a2552.ts": A2552_TS,
  "src/a2305.ts": A2305_TS,
  "src/a2724.ts": A2724_TS,
  "src/a2322.ts": A2322_TS,
  "src/a2307.ts": A2307_TS,
  "src/enumcase.ts": ENUM_TS,
};

const TS_STRICT_CONFIG = JSON.stringify(
  {
    compilerOptions: { strict: true, target: "es2020", module: "commonjs", noEmit: true, skipLibCheck: true },
    include: ["src"],
  },
  null,
  2
);

const scratchRoots = [];
const mkScratch = (tag) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `blind-v9-repair-${tag}-`));
  scratchRoots.push(root);
  return root;
};
const linkRepoTs = (root) => {
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.symlinkSync(REPO_TS_DIR, path.join(root, "node_modules", "typescript"), "dir");
};

let clsfxP;
const clsfx = () =>
  (clsfxP ||= (async () => {
    const root = mkScratch("clsfx");
    writeTree(root, { "tsconfig.json": TS_STRICT_CONFIG, ...CLSFX_FILES });
    linkRepoTs(root);
    const run = spawnSync(process.execPath, [TSC_BIN, "--noEmit", "--pretty", "false", "-p", root], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notStrictEqual(run.status, 0, "the classifier fixture project must fail its real check");
    const oracle = new TsOracle();
    const diags = oracle.parseCheckOutput(run.stdout, root);
    assert.ok(diags.length >= 9, `every fixture file yields its real diagnostic, got ${diags.length}:\n${run.stdout}`);
    const diagFor = (code, fileHint) => {
      const d = diags.find(
        (x) => x.code === code && (!fileHint || (x.spans[0] && x.spans[0].fileName.includes(fileHint)))
      );
      assert.ok(d, `real fixture diagnostic ${code} (${fileHint || "any"}) captured; stdout:\n${run.stdout}`);
      return d;
    };
    const docFor = (rel) => makeHeadlessDoc(CLSFX_FILES[rel], "file://" + path.join(root, rel), "typescript");
    return { root, stdout: run.stdout, diagFor, docFor };
  })());

const driveInjection = async (extractor, rel, code, fileHint) => {
  const fx = await clsfx();
  const d = fx.diagFor(code, fileHint);
  const doc = fx.docFor(rel);
  const r = await resolveSurfaceInjection(extractor, doc, [d], () => {});
  return surfaceOf(r);
};

// ===========================================================================
// A1. TS2339 / TS2551: signatures-first member surface. [surface: 'TS2339/
// TS2551 ... unresolved-method or unresolved-field ... signatures first
// (member set via completeMembers at the error site)'] RED until 4B lands.
// ===========================================================================

gtestA("classifier TS2339: a property miss injects the receiver's member SIGNATURES via completeMembers at the error site [surface: 'TS2339/TS2551 => unresolved-method or unresolved-field' + 'signatures first (member set via completeMembers at the error site)']", async () => {
  const ext = recordingExtractor({
    completeMembers: [
      { name: "reference", signature: "reference: string", kind: "field" },
      { name: "placedBy", signature: "placedBy: string", kind: "field" },
      { name: "total", signature: "total(): number", kind: "method" },
    ],
  });
  const out = await driveInjection(ext, "src/a2339.ts", "TS2339", "a2339");
  assert.ok(out, `a TS2339 with resolvable members must inject a member surface; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("Order"), `the quoted receiver type is named; got: ${out}`);
  assert.ok(out.includes("total(): number"), `the REAL member signatures are the payload; got: ${out}`);
  assert.ok(out.includes("reference: string"), `field signatures ride along; got: ${out}`);
  assert.ok(ext.calls.completeMembers.length >= 1, "completeMembers was consulted");
  const fx = await clsfx();
  const span = fx.diagFor("TS2339", "a2339").spans[0];
  assert.ok(
    ext.calls.completeMembers.some((a) => a[0] && a[0].line === span.lineStart - 1),
    `completeMembers ran at the error site (0-based line ${span.lineStart - 1}); calls=${JSON.stringify(ext.calls.completeMembers)}`
  );
  assert.ok(!/\bcity\s*:\s*\w/.test(out), "the invented member never renders as a real typed member");
  assertNoExampleDispatch(ext, out);
});

gtestA("classifier TS2551: a did-you-mean property miss injects the receiver's member signatures [surface: 'TS2339/TS2551 (property does not exist [did you mean])']", async () => {
  const ext = recordingExtractor({
    completeMembers: [{ name: "setTheme", signature: "setTheme(theme: string): void", kind: "method" }],
  });
  const out = await driveInjection(ext, "src/a2551.ts", "TS2551", "a2551");
  assert.ok(out, `a TS2551 with resolvable members must inject a member surface; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("ThemeStore"), `the quoted receiver type is named; got: ${out}`);
  assert.ok(out.includes("setTheme(theme: string): void"), `the real signature is the payload; got: ${out}`);
  assert.ok(ext.calls.completeMembers.length >= 1, "completeMembers was consulted");
  assertNoExampleDispatch(ext, out);
});

// ===========================================================================
// A2. Field-shape honesty. [surface: 'Field shape for TS' - the TS hover hook
// + honest name-only rendering + the enum hazard] RED until 4B lands.
// ===========================================================================

gtestA("field shape: a field miss whose receiver resolves through the TS hooks renders the REAL fields (hover/def surface, TS syntax) [surface: 'resolveFieldShape's Rust hover keyword guard is hook-dispatched; the TS hook accepts interface/class/enum/type-alias hovers']", async () => {
  const fx = await clsfx();
  const consumerUri = "file://" + path.join(fx.root, "src/a2339.ts");
  const orderUri = "file://" + path.join(fx.root, "src/order.ts");
  const textFor = (uri) => (uri === orderUri ? ORDER_TS : A2339_TS);
  const orderIdx = ORDER_TS.indexOf("Order");
  const ext = recordingExtractor({
    completeMembers: [],
    hoverSurface: (cursor) =>
      wordAtText(textFor(cursor.uri || consumerUri), cursor) === "Order"
        ? { signature: "type Order = { reference: string; placedBy: string }" }
        : undefined,
    definition: (cursor) =>
      wordAtText(textFor(cursor.uri || consumerUri), cursor) === "Order"
        ? { uri: orderUri, range: { startLine: 0, startCharacter: orderIdx, endLine: 0, endCharacter: orderIdx + 5 } }
        : undefined,
    membersOfType: [
      { name: "reference", signature: "reference: string", kind: "field" },
      { name: "placedBy", signature: "placedBy: string", kind: "field" },
    ],
  });
  const out = await driveInjection(ext, "src/a2339.ts", "TS2339", "a2339");
  assert.ok(out, `the resolvable receiver type must produce a field surface; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("reference"), `Order's real field reference renders; got: ${out}`);
  assert.ok(out.includes("placedBy"), `Order's real field placedBy renders; got: ${out}`);
  assert.ok(/string/.test(out), `the real field types render; got: ${out}`);
  assert.ok(!/pub struct|pub enum|&self/.test(out), `the render is TS-shaped, never Rust syntax; got: ${out}`);
  assertNoExampleDispatch(ext, out);
});

gtestA("field shape: name-only members render as bare names - no invented types [surface: 'membersOfType may deliver names+kinds only - the TS renderer emits name-only fields honestly, never invented types']", async () => {
  const ext = recordingExtractor({
    completeMembers: [
      { name: "reference", kind: "field" },
      { name: "placedBy", kind: "field" },
    ],
  });
  const out = await driveInjection(ext, "src/a2339.ts", "TS2339", "a2339");
  assert.ok(out, `name-only members must still surface (the signature-less render), got ${JSON.stringify(out)}`);
  assert.ok(out.includes("reference"), `the member NAME renders; got: ${out}`);
  assert.ok(out.includes("placedBy"), `the member NAME renders; got: ${out}`);
  assert.ok(!/reference\s*:\s*\w/.test(out), `no type may be invented for a name-only member; got: ${out}`);
  assert.ok(!/placedBy\s*:\s*\w/.test(out), `no type may be invented for a name-only member; got: ${out}`);
  assertNoExampleDispatch(ext, out);
});

gtestA("field shape: a TS ENUM hover is parsed by the TS hook, not the Rust struct/enum regex - enum-shaped output [surface: 'must NOT let the Rust struct/enum regex match TS enum hover text (the round-1 latent hazard)']", async () => {
  const fx = await clsfx();
  const enumUri = "file://" + path.join(fx.root, "src/enumcase.ts");
  const enumIdx = ENUM_TS.indexOf("ColorMode");
  const ext = recordingExtractor({
    completeMembers: [],
    hoverSurface: (cursor) =>
      wordAtText(ENUM_TS, cursor) === "ColorMode" ? { signature: "enum ColorMode" } : undefined,
    definition: (cursor) =>
      wordAtText(ENUM_TS, cursor) === "ColorMode"
        ? { uri: enumUri, range: { startLine: 0, startCharacter: enumIdx, endLine: 0, endCharacter: enumIdx + 9 } }
        : undefined,
    membersOfType: [
      { name: "Dark", kind: "field" },
      { name: "Light", kind: "field" },
    ],
  });
  const out = await driveInjection(ext, "src/enumcase.ts", "TS2339", "enumcase");
  assert.ok(out, `the enum receiver must surface (its real members exist); got ${JSON.stringify(out)}`);
  assert.ok(out.includes("ColorMode"), `the enum is named; got: ${out}`);
  assert.ok(out.includes("Dark") && out.includes("Light"), `the real enum members render; got: ${out}`);
  assert.ok(!/\bpub\b|struct\s+ColorMode|&self/.test(out), `never rust-struct-shaped; got: ${out}`);
  assert.ok(!/Dark\s*:\s*\w/.test(out) && !/Light\s*:\s*\w/.test(out), `no invented member types on the enum members; got: ${out}`);
  assertNoExampleDispatch(ext, out);
});

// ===========================================================================
// A3. TS2305 / TS2724: the wrong-item treatment. [surface: 'TS2305/TS2724
// (module has no exported member) => wrong-item'] RED until 4B lands.
// ===========================================================================

gtestA("classifier TS2305: no-exported-member gets the wrong-item treatment - a payload naming the quoted item, no example [surface: 'TS2305/TS2724 ... => wrong-item']", async () => {
  const ext = recordingExtractor({});
  const out = await driveInjection(ext, "src/a2305.ts", "TS2305", "a2305");
  assert.ok(out, `a TS2305 must be classified (wrong-item), not silently dropped; got ${JSON.stringify(out)}`);
  assert.ok(out.includes("missingThing"), `the quoted missing member is named; got: ${out}`);
  assertNoExampleDispatch(ext, out);
});

gtestA("classifier TS2724: the did-you-mean no-exported-member shape is wrong-item too [surface: 'TS2305/TS2724 ... => wrong-item']", async () => {
  const ext = recordingExtractor({});
  const out = await driveInjection(ext, "src/a2724.ts", "TS2724", "a2724");
  assert.ok(out, `a TS2724 must be classified (wrong-item); got ${JSON.stringify(out)}`);
  assert.ok(out.includes("Orderr"), `the quoted missing member is named; got: ${out}`);
  assertNoExampleDispatch(ext, out);
});

// ===========================================================================
// A4. TS2304 / TS2552: the qualify class - injection-side restraint. The
// POSITIVE qualify behavior (consent gate) is pinned in layer B; here we pin
// that these codes never ride the example leg and never leak example content.
// [surface: 'TS2304/TS2552 (cannot find name) => the qualify class'] GREEN
// today (nothing injects) and must STAY honest post-4B.
// ===========================================================================

for (const c of [
  { code: "TS2304", rel: "src/a2304.ts", hint: "a2304" },
  { code: "TS2552", rel: "src/a2552.ts", hint: "a2552" },
]) {
  gtestA(`classifier ${c.code}: the qualify class never consults the example leg and never leaks example content [surface: 'TS2304/TS2552 ... => the qualify class' + 'example legs are dark for TS']`, async () => {
    const ext = recordingExtractor({
      completeMembers: [{ name: "trapMember", signature: "trapMember(x: number): void", kind: "method" }],
      qualifyImport: { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, newText: 'import { soleExport } from "./soleprovider";\n' },
    });
    const out = await driveInjection(ext, c.rel, c.code, c.hint);
    assertNoExampleDispatch(ext, out);
  });
}

// ===========================================================================
// A5. Everything else: honest restraint. [surface: 'Everything else => no
// class (no injection) - honest restraint'] GREEN today - a freeze pin.
// ===========================================================================

for (const c of [
  { code: "TS2322", rel: "src/a2322.ts", hint: "a2322", why: "a plain type mismatch" },
  { code: "TS2307", rel: "src/a2307.ts", hint: "a2307", why: "an unresolved module (not in the classified set)" },
]) {
  gtestA(`honest restraint ${c.code}: ${c.why} injects NOTHING even with a generous extractor [surface: 'Everything else => no class (no injection) - honest restraint']`, async () => {
    const ext = recordingExtractor({
      completeMembers: [{ name: "trapMember", signature: "trapMember(x: number): void", kind: "method" }],
      hoverSurface: { signature: "type Trap = { trapField: string }" },
    });
    const out = await driveInjection(ext, c.rel, c.code, c.hint);
    assert.ok(out === undefined || out === "", `no injection for ${c.code}; got ${JSON.stringify(out)}`);
    assertNoExampleDispatch(ext, out);
  });
}

// ===========================================================================
// A6. Coverage fallback, REAL spawns. [surface: 4B amendments 'The 4B
// solution-shell rule GENERALIZES to one coverage-fallback rule'] The shell
// and sibling cases are RED today (the old skip); the covered-by-nothing case
// is the GREEN honest-dark freeze pin.
// ===========================================================================

const APP_TSX = "export function App(): number {\n  const label: string = \"app\";\n  const count: number = label;\n  return count;\n}\n";

gtestA("coverage fallback (a): a vite-style solution shell (files:[] + references) resolves a REAL verdict end to end, and the winner is cached per (root, file) [surface: 'when the coverage probe says the file is NOT an input of the nearest tsconfig, before going dark, check (a) projects listed in that tsconfig's references' + 'cached per (root, file)']", async () => {
  const root = mkScratch("vshell");
  writeTree(root, {
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }, null, 2),
    "tsconfig.app.json": JSON.stringify(
      {
        compilerOptions: { strict: true, target: "es2020", module: "esnext", moduleResolution: "bundler", jsx: "preserve", noEmit: true, skipLibCheck: true, composite: true },
        include: ["src"],
      },
      null,
      2
    ),
    "src/App.tsx": APP_TSX,
  });
  linkRepoTs(root);
  const file = path.join(root, "src", "App.tsx");
  const logs = [];
  const oracle = new TsOracle({ log: (l) => logs.push(l) });
  const spawns = [];
  const result = await runOracleCheck(oracle, file, { runCommand: realRunCommand(spawns), log: (l) => logs.push(l) });
  assert.ok(result, `the shell must resolve into its referenced project, NOT the old skip; logs=${JSON.stringify(logs)}`);
  assert.strictEqual(result.success, false, "the real check found the real type error");
  const d = result.diagnostics.find((x) => x.code === "TS2322");
  assert.ok(d, `the referenced project's check delivered the TS2322; got ${JSON.stringify(result.diagnostics.map((x) => x.code))}`);
  assert.ok(d.spans[0] && d.spans[0].fileName.includes("App.tsx"), "the diagnostic lands in the accepted file");
  assert.ok(d.spans[0].byteStart >= 0, "byte conversion rode along (the file was really read)");

  // Cached: a second check of the SAME (root, file) pair re-probes nothing.
  const spawns2 = [];
  const again = await runOracleCheck(oracle, file, { runCommand: realRunCommand(spawns2), log: (l) => logs.push(l) });
  assert.ok(again, "the cached winner still resolves a verdict");
  assert.strictEqual(again.success, false);
  assert.strictEqual(spawns2.length, 1, `the repeat run spawns only the check - the fallback winner is cached; spawned ${JSON.stringify(spawns2.map((c) => c.args))}`);
  assert.ok(!isProbe(spawns2[0]), "the one repeat spawn is the check, not a probe");
});

gtestA("coverage fallback (b): a sibling tsconfig.server.json exclusively covering server/** resolves a REAL verdict [surface: '(b) sibling tsconfig.*.json files in the same directory (the tsconfig.server.json / tsconfig.node.json shape)']", async () => {
  const root = mkScratch("servroot");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "tsconfig.server.json": JSON.stringify(
      {
        compilerOptions: { strict: true, target: "es2020", module: "commonjs", noEmit: true, skipLibCheck: true },
        include: ["server"],
      },
      null,
      2
    ),
    "src/index.ts": "export const fine: number = 1;\n",
    "server/main.ts": "export function boot(): number {\n  const port: string = \"8080\";\n  const n: number = port;\n  return n;\n}\n",
  });
  linkRepoTs(root);
  const file = path.join(root, "server", "main.ts");
  const logs = [];
  const oracle = new TsOracle({ log: (l) => logs.push(l) });
  const result = await runOracleCheck(oracle, file, { runCommand: realRunCommand(), log: (l) => logs.push(l) });
  assert.ok(result, `the sibling config covers this file: a real verdict, not honest-dark; logs=${JSON.stringify(logs)}`);
  assert.strictEqual(result.success, false, "the server file's real type error fails the check");
  const d = result.diagnostics.find((x) => x.code === "TS2322");
  assert.ok(d, `the sibling project's check delivered the TS2322; got ${JSON.stringify(result.diagnostics.map((x) => x.code))}`);
  assert.ok(d.spans[0] && d.spans[0].fileName.includes("main.ts"), "the diagnostic lands in the server file");
});

gtestA("coverage fallback (c): a file covered by NOTHING keeps the honest-dark skip and its evidence line [surface: 'nothing found = the existing honest-dark skip with its evidence line']", async () => {
  const root = mkScratch("orphan");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/index.ts": "export const fine: number = 1;\n",
    "other/lone.ts": "export const lone: number = 1;\n",
  });
  linkRepoTs(root);
  const file = path.join(root, "other", "lone.ts");
  const logs = [];
  const oracle = new TsOracle({ log: (l) => logs.push(l) });
  const result = await runOracleCheck(oracle, file, { runCommand: realRunCommand(), log: (l) => logs.push(l) });
  assert.strictEqual(result, undefined, "no project covers the file: the unearned green stays refused");
  assert.ok(
    logs.some((l) => l.includes("not an input") && l.includes(file)),
    `the evidence line survives and names the file; logs=${JSON.stringify(logs)}`
  );
});

// ===========================================================================
// A7. Autosave guard. [surface: 'the check records its start time; at parse
// time, a file whose mtime is newer than check start gets the -1 sentinel
// (never in-span) plus one channel line `content changed since check;
// offsets skipped`'] RED today; the unchanged control is a freeze pin.
// ===========================================================================

const AUTOSAVE_SRC = 'const label: string = "task";\nconst count: number = label;\nexport { count };\n';
const AUTOSAVE_TSC_OUT = "src/app.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.\n";

const autosaveProject = (tag) => {
  const root = mkScratch(tag);
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/app.ts": AUTOSAVE_SRC,
    "node_modules/typescript/bin/tsc": "// placeholder: the runCommand below is a fake, this file only satisfies detection\n",
  });
  return { root, file: path.join(root, "src", "app.ts") };
};

const autosaveRun = (P, touchDuringCheck) => {
  const logs = [];
  const oracle = new TsOracle({ log: (l) => logs.push(l) });
  const runCommand = async (cmd) => {
    if (isProbe(cmd)) return { stdout: P.file + "\n", exitCode: 0 };
    if (touchDuringCheck) {
      const future = new Date(Date.now() + 120000);
      fs.utimesSync(P.file, future, future);
    }
    return { stdout: AUTOSAVE_TSC_OUT, exitCode: 2 };
  };
  return runOracleCheck(oracle, P.file, { runCommand, log: (l) => logs.push(l) }).then((result) => ({ result, logs }));
};

gtestA("autosave guard: a target whose mtime is newer than the check start parses to the -1 sentinel plus the channel line [surface: 'Autosave guard (scraps phase 2 finding 5)']", async () => {
  const P = autosaveProject("asguard");
  const { result, logs } = await autosaveRun(P, true);
  assert.ok(result, "the check itself completed");
  assert.strictEqual(result.success, false);
  const span = result.diagnostics[0].spans[0];
  assert.strictEqual(span.byteStart, -1, "-1 can never test inside any repair scope: the safe direction wins");
  assert.strictEqual(span.byteEnd, -1);
  assert.ok(
    logs.some((l) => l.includes("content changed since check; offsets skipped")),
    `the exact channel line rides the skip; logs=${JSON.stringify(logs)}`
  );
});

gtestA("autosave control: an UNCHANGED target keeps its real byte offsets [freeze pin - the guard must not fire on a quiet file]", async () => {
  const P = autosaveProject("asctrl");
  const { result, logs } = await autosaveRun(P, false);
  assert.ok(result, "the check completed");
  const span = result.diagnostics[0].spans[0];
  assert.strictEqual(span.byteStart, 36, "the real conversion: line 1 (29 bytes + newline) + 6 units of 'const '");
  assert.strictEqual(span.byteEnd, 36);
  assert.ok(
    !logs.some((l) => l.includes("content changed since check")),
    `no false-positive guard line on an unchanged file; logs=${JSON.stringify(logs)}`
  );
});

// ===========================================================================
// Layer B: the extension against a widened vscode stub. Captures every
// verdict surface (messages, status bar, decorations, shown documents) and
// every edit-application path (workspace.applyEdit, editor.edit) - the
// observation points for the qualify consent gate and env surfacing. The
// OUTPUT CHANNEL is deliberately excluded from the "surfaces" aggregate: the
// contract distinguishes the channel (detailed record) from the user-facing
// toast/verdict surface.
// ===========================================================================

const STUB_X = path.join(__dirname, ".blind-v9-repair-stub.cjs");
fs.writeFileSync(
  STUB_X,
  `
const state = {
  config: {}, messages: [], commands: {}, executeCalls: [], commandHandlers: {},
  outputLines: [], inlineProviders: [], contentProviders: {},
  textDocuments: [], visibleTextEditors: [], activeTextEditor: undefined,
  collections: [], statusBars: [], decorations: [], appliedEdits: [], shownDocs: [], editorEdits: [],
};
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
    const s = this.start, e = this.end;
    const ps = p.start ? p.start : p;
    const pe = p.end ? p.end : p;
    const geS = ps.line > s.line || (ps.line === s.line && ps.character >= s.character);
    const leE = pe.line < e.line || (pe.line === e.line && pe.character <= e.character);
    return geS && leE;
  }
  with(start, end) { return new Range(start || this.start, end || this.end); }
  intersection() { return undefined; }
  union(o) { return o; }
}
class Selection extends Range {
  constructor(a, b, c, d) { super(a, b, c, d); this.anchor = this.start; this.active = this.end; this.isReversed = false; }
}
class WorkspaceEdit {
  constructor() { this._entries = []; }
  replace(uri, range, text) { this._entries.push([uri, [{ range, newText: text }]]); }
  insert(uri, pos, text) { this._entries.push([uri, [{ range: new Range(pos, pos), newText: text }]]); }
  entries() { return this._entries; }
}
class EventEmitter {
  constructor() { this.handlers = []; }
  get event() { return (fn) => { this.handlers.push(fn); return { dispose() {} }; }; }
  fire(x) { for (const h of this.handlers) h(x); }
  dispose() {}
}
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString {
  constructor(value) { this.value = value || ""; this.isTrusted = false; }
  appendCodeblock(t, lang) { this.value += "\\n\`\`\`" + (lang || "") + "\\n" + t + "\\n\`\`\`\\n"; }
  appendMarkdown(t) { this.value += t; }
  appendText(t) { this.value += t; }
}
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class SnippetString { constructor(value) { this.value = value || ""; } appendText(t) { this.value += t; return this; } appendTabstop() { return this; } }
class InlineCompletionItem { constructor(insertText, range, command) { this.insertText = insertText; this.range = range; this.command = command; } }
class InlineCompletionList { constructor(items) { this.items = items; } }
class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
class Location { constructor(uri, rangeOrPos) { this.uri = uri; this.range = rangeOrPos; } }
class Hover { constructor(contents, range) { this.contents = Array.isArray(contents) ? contents : [contents]; this.range = range; } }
class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
class CancellationTokenSource {
  constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }; }
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}
const mkUri = (full, fsPath) => ({
  scheme: full.includes("://") ? full.slice(0, full.indexOf("://")) : "file",
  fsPath, path: fsPath, query: "", fragment: "",
  toString: () => full,
  with() { return this; },
  toJSON() { return full; },
});
const Uri = {
  file: (p) => mkUri("file://" + p, p),
  parse: (s) => mkUri(String(s), String(s).replace(/^[a-zA-Z+-]+:\\/\\//, "")),
  joinPath: (base, ...segs) => Uri.file([base.fsPath, ...segs].join("/")),
  from: (c) => {
    const full =
      (c.scheme || "file") + "://" + (c.authority || "") + (c.path || "") +
      (c.query ? "?" + c.query : "") + (c.fragment ? "#" + c.fragment : "");
    const u = mkUri(full, c.path || "");
    u.scheme = c.scheme || "file";
    u.query = c.query || "";
    u.fragment = c.fragment || "";
    return u;
  },
};
const disposable = () => ({ dispose() {} });
const recordShownDoc = (document) => {
  try {
    state.shownDocs.push({
      uri: document && document.uri ? String(document.uri.toString ? document.uri.toString() : document.uri) : "",
      text: document && typeof document.getText === "function" ? document.getText() : "",
    });
  } catch {}
};
module.exports = {
  __state: state,
  version: "1.85.0",
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Diagnostic, SnippetString, InlineCompletionItem, InlineCompletionList, TreeItem,
  Location, Hover, RelativePattern, CancellationTokenSource, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13,
    String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
    Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
    Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
    Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EndOfLine: { LF: 1, CRLF: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  CodeActionKind: { QuickFix: { value: "quickfix" }, Refactor: { value: "refactor" } },
  workspace: {
    getConfiguration: (section) => ({
      get: (key, fallback) => {
        if (key in state.config) return state.config[key];
        const full = section ? section + "." + key : key;
        if (full in state.config) return state.config[full];
        return fallback;
      },
      has: (key) => key in state.config,
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidRenameFiles: () => disposable(),
    onDidDeleteFiles: () => disposable(),
    onDidSaveTextDocument: () => disposable(),
    registerTextDocumentContentProvider: (scheme, provider) => {
      state.contentProviders[scheme] = provider;
      return disposable();
    },
    get textDocuments() { return state.textDocuments; },
    openTextDocument: async (arg) => {
      const key = typeof arg === "string" ? arg : arg && arg.toString ? arg.toString() : String(arg);
      const docs = globalThis.__V9_DOCS__ || {};
      if (docs[key]) return docs[key];
      const scheme = key.includes("://") ? key.slice(0, key.indexOf("://")) : "file";
      const provider = state.contentProviders[scheme];
      const text = provider ? await provider.provideTextDocumentContent(typeof arg === "string" ? Uri.parse(arg) : arg) : "";
      const lines = String(text || "").split("\\n");
      return {
        uri: typeof arg === "string" ? Uri.parse(arg) : arg,
        languageId: "plaintext", version: 1, lineCount: lines.length,
        getText: () => text || "",
        lineAt: (n) => { const i = typeof n === "number" ? n : n.line; const t = lines[i] || ""; return { lineNumber: i, text: t, firstNonWhitespaceCharacterIndex: 0, isEmptyOrWhitespace: t.trim() === "", range: new Range(i, 0, i, t.length) }; },
        offsetAt: () => 0, positionAt: () => new Position(0, 0), save: async () => true,
      };
    },
    applyEdit: async (edit) => {
      try {
        const entries = edit && typeof edit.entries === "function" ? edit.entries() : [];
        state.appliedEdits.push(entries.map(([uri, edits]) => ({
          uri: String(uri && uri.toString ? uri.toString() : uri),
          texts: (edits || []).map((e) => e.newText),
        })));
      } catch { state.appliedEdits.push([{ uri: "unserializable", texts: [] }]); }
      return true;
    },
    get workspaceFolders() { return [{ uri: Uri.file("/proj"), name: "proj", index: 0 }]; },
    asRelativePath: (u) => String(u),
    createFileSystemWatcher: () => ({ onDidChange: () => disposable(), onDidCreate: () => disposable(), onDidDelete: () => disposable(), dispose() {} }),
    fs: { stat: async () => ({ type: 1 }), readFile: async () => new Uint8Array() },
  },
  languages: {
    createDiagnosticCollection: (name) => {
      const c = { name, set() {}, delete() {}, clear() {}, dispose() {} };
      state.collections.push(c);
      return c;
    },
    registerInlineCompletionItemProvider: (selector, provider) => {
      state.inlineProviders.push({ selector, provider });
      return disposable();
    },
    registerCodeActionsProvider: () => disposable(),
    registerCodeLensProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => disposable(),
    setLanguageConfiguration: () => disposable(),
  },
  window: {
    createOutputChannel: (name) => ({
      name,
      appendLine: (l) => state.outputLines.push(l),
      append: (l) => state.outputLines.push(l),
      replace() {}, show() {}, hide() {}, clear() {}, dispose() {},
    }),
    createStatusBarItem: () => {
      const item = { text: "", tooltip: "", command: undefined, backgroundColor: undefined, show() {}, hide() {}, dispose() {} };
      state.statusBars.push(item);
      return item;
    },
    createTextEditorDecorationType: (opts) => ({ opts, dispose() {} }),
    get visibleTextEditors() { return state.visibleTextEditors; },
    get activeTextEditor() { return state.activeTextEditor; },
    onDidChangeActiveTextEditor: () => disposable(),
    onDidChangeTextEditorSelection: () => disposable(),
    onDidChangeVisibleTextEditors: () => disposable(),
    showInformationMessage: async (message, ...actions) => { state.messages.push({ kind: "info", message, actions }); return undefined; },
    showWarningMessage: async (message, ...actions) => { state.messages.push({ kind: "warn", message, actions }); return undefined; },
    showErrorMessage: async (message, ...actions) => { state.messages.push({ kind: "error", message, actions }); return undefined; },
    showQuickPick: async () => undefined,
    withProgress: async (opts, task) => task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable() }),
    setStatusBarMessage: (message) => { state.messages.push({ kind: "status", message: String(message) }); return disposable(); },
    showTextDocument: async (docOrUri) => {
      const document = docOrUri && typeof docOrUri.getText === "function" ? docOrUri : { uri: docOrUri, getText: () => "", languageId: "plaintext", version: 1 };
      recordShownDoc(document);
      return {
        document,
        selection: new Selection(new Position(0, 0), new Position(0, 0)),
        options: {}, viewColumn: 1,
        edit: async (cb) => {
          const ops = [];
          cb({ replace: (r, t) => ops.push(t), insert: (p, t) => ops.push(t), delete: () => ops.push("") });
          state.editorEdits.push(ops);
          return true;
        },
        insertSnippet: async () => true,
        setDecorations: (type, args) => { state.decorations.push({ opts: type && type.opts, args }); },
        revealRange() {},
      };
    },
    tabGroups: { all: [], onDidChangeTabs: () => disposable(), close: async () => {} },
    createTreeView: () => ({ dispose() {}, onDidChangeSelection: () => disposable(), onDidChangeVisibility: () => disposable(), reveal: async () => {} }),
    registerTreeDataProvider: () => disposable(),
    registerWebviewViewProvider: () => disposable(),
    activeColorTheme: { kind: 1 },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return disposable(); },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      const h = state.commandHandlers[id];
      if (h) return h(...args);
      if (state.commands[id]) return state.commands[id](...args);
      return undefined;
    },
    getCommands: async () => Object.keys(state.commands),
  },
  env: { appName: "stub", machineId: "stub", clipboard: { writeText: async () => {} }, openExternal: async () => true },
  extensions: { getExtension: () => undefined, all: [] },
};
`
);

const entryX = path.join(__dirname, ".blind-v9-repair-ext.entry.ts");
const outX = path.join(__dirname, ".blind-v9-repair-ext.bundle.cjs");
let modX = {};
let bundleErrorX;
try {
  fs.writeFileSync(
    entryX,
    `export { activate } from "../src/vscode/extension";
export { __state, Position, Range, Selection, Uri, Location } from "vscode";\n`
  );
  esbuild.buildSync({ entryPoints: [entryX], bundle: true, outfile: outX, format: "cjs", platform: "node", alias: { vscode: STUB_X } });
  modX = require(outX);
} catch (e) {
  bundleErrorX = e;
}
if (!bundleErrorX && typeof modX.activate !== "function") {
  bundleErrorX = new Error("the extension bundle built but exports no activate function");
}
const { activate, __state, Position, Selection, Uri } = modX;

test("bundle X: the extension entry builds and activates against the widened stub [harness guard]", async () => {
  if (bundleErrorX) assert.fail(`the extension surface is not buildable: ${bundleErrorX.message}`);
  await harness();
});

const gtestX = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErrorX) return ctx.skip("extension bundle failed; see the bundle X test");
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// Fake Ollama (the blind-v9-gestures pattern): tags list every configured
// model, generate answers ndjson.
// ---------------------------------------------------------------------------

const MODELS = ["fake-fim", "fake-30b", "fake-14b"];

function startServer() {
  const srv = { requests: [], replyFor: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = { raw }; }
      srv.requests.push({ method: req.method, url: req.url, body });
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: MODELS.map((name) => ({ name, model: name })) }));
        return;
      }
      if (req.url === "/api/generate") {
        const text = (srv.replyFor && srv.replyFor(body)) || "0";
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(JSON.stringify({ response: text }) + "\n");
        res.write(JSON.stringify({ response: "", done: true, done_reason: "stop" }) + "\n");
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      srv.apiBase = `http://127.0.0.1:${server.address().port}`;
      srv.close = () => new Promise((r) => server.close(r));
      resolve(srv);
    });
  });
}

const waitFor = async (predicate, what, tries = 400, soft = false) => {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await sleep(25);
  }
  if (soft) return false;
  assert.fail(`timed out waiting for ${what}`);
};

let harnessP;
let serverRef;
const harness = () =>
  (harnessP ||= (async () => {
    if (bundleErrorX) throw bundleErrorX;
    const srv = await startServer();
    serverRef = srv;
    __state.config = {
      enabled: true,
      apiBase: srv.apiBase,
      fimModel: "fake-fim",
      fnGenModel: "fake-30b",
      fnGenFallbackModel: "fake-14b",
      fnGenProvider: "ollama",
      cloudApiKey: "",
      cloudApiBase: "",
      hardwareTier: "16gb-large-ram",
      maxTokens: 128,
      temperature: 0.01,
      debounceMs: 0,
      prefixChars: 3000,
      suffixChars: 1000,
      multiline: true,
      repairEnabled: false,
      compilerDirectedInjection: true,
    };
    const mem = { get: (k, f) => f, update: async () => {}, keys: () => [], setKeysForSync() {} };
    const context = {
      subscriptions: [],
      globalState: mem,
      workspaceState: mem,
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
      extensionUri: Uri.file("/ext"),
      extensionPath: "/ext",
      extensionMode: 1,
      asAbsolutePath: (p) => "/ext/" + p,
      globalStorageUri: Uri.file("/tmp/blind-v9-repair-storage"),
      logUri: Uri.file("/tmp/blind-v9-repair-log"),
      environmentVariableCollection: { replace() {}, append() {}, prepend() {}, clear() {} },
    };
    await activate(context);
    await waitFor(() => typeof __state.commands["column80.repairFunction"] === "function", "repairFunction registration");
    await waitFor(() => __state.outputLines.some((l) => l.includes("tier=")), "tier resolution line", 200, true);
    return { srv, context };
  })());

test.after(async () => {
  try {
    if (serverRef) await serverRef.close();
  } catch {}
  fs.rmSync(entryA, { force: true });
  fs.rmSync(outA, { force: true });
  fs.rmSync(STUB_A, { force: true });
  fs.rmSync(entryX, { force: true });
  fs.rmSync(outX, { force: true });
  fs.rmSync(STUB_X, { force: true });
  for (const root of scratchRoots) fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Document / editor fakes (the gestures mechanics, plus decoration capture).
// ---------------------------------------------------------------------------

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  };
  return {
    uri: Uri.parse(uriStr),
    fileName: uriStr.replace(/^file:\/\//, ""),
    languageId,
    version: 1,
    isDirty: false,
    isUntitled: false,
    isClosed: false,
    eol: 1,
    lineCount: lines.length,
    save: async () => true,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return {
        lineNumber: n,
        text: t,
        range: new modX.Range(n, 0, n, t.length),
        rangeIncludingLineBreak: new modX.Range(n, 0, n + 1, 0),
        firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
        isEmptyOrWhitespace: !m,
      };
    },
    getWordRangeAtPosition: (pos) => {
      const t = lines[pos.line] ?? "";
      const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
      let s = Math.min(pos.character, t.length);
      let e = s;
      while (s > 0 && isWord(t[s - 1])) s--;
      while (e < t.length && isWord(t[e])) e++;
      return e > s ? new modX.Range(pos.line, s, pos.line, e) : undefined;
    },
  };
}

const makeEditor = (doc, pos) => ({
  document: doc,
  selection: new Selection(pos, pos),
  selections: [new Selection(pos, pos)],
  options: { tabSize: 4, insertSpaces: true },
  viewColumn: 1,
  edit: async (cb) => {
    const ops = [];
    cb({ replace: (r, t) => ops.push(t), insert: (p, t) => ops.push(t), delete: () => ops.push("") });
    __state.editorEdits.push(ops);
    return true;
  },
  insertSnippet: async () => true,
  setDecorations: (type, args) => {
    __state.decorations.push({ opts: type && type.opts, args });
  },
  revealRange() {},
});

const posOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  return new Position(line, idx - (before.lastIndexOf("\n") + 1));
};

const vr = (sl, sc, el, ec) => new modX.Range(sl, sc, el, ec);
const dsym = (name, kind, range, selectionRange, children = [], detail = "") => ({
  name, detail, kind, range, selectionRange, children,
});

const resetDrive = (handlers, docs, editor) => {
  __state.commandHandlers = handlers || {};
  __state.messages.length = 0;
  __state.executeCalls.length = 0;
  __state.decorations.length = 0;
  __state.appliedEdits.length = 0;
  __state.shownDocs.length = 0;
  __state.editorEdits.length = 0;
  globalThis.__V9_DOCS__ = docs || {};
  __state.activeTextEditor = editor;
  __state.textDocuments = editor ? [editor.document] : [];
  __state.visibleTextEditors = editor ? [editor] : [];
  serverRef.requests.length = 0;
  serverRef.replyFor = null;
};

// Everything the USER can see except the output channel: toasts, status bar
// text, decorations, and any shown document. [surface: 'the existing
// toast/verdict surface states the one-line reason' - 'the same surfaces
// that already show verdicts']
const surfacesText = () =>
  [
    __state.messages.map((m) => m.message).join("\n"),
    __state.statusBars.map((b) => `${b.text} ${b.tooltip || ""}`).join("\n"),
    JSON.stringify(__state.decorations),
    __state.shownDocs.map((d) => `${d.uri} ${d.text}`).join("\n"),
  ].join("\n");

const appliedText = () => JSON.stringify(__state.appliedEdits) + JSON.stringify(__state.editorEdits);

const diagX = () =>
  `messages=${JSON.stringify(__state.messages)} lastLog=${JSON.stringify(__state.outputLines.slice(-8))}`;

// Drive column80.repairFunction against a real on-disk project file and wait
// for the command to settle (real tsc spawns take seconds).
async function driveRepair({ doc, cursor, handlers, docs }) {
  await harness();
  resetDrive(handlers, docs, makeEditor(doc, cursor));
  const cmd = __state.commands["column80.repairFunction"];
  assert.strictEqual(typeof cmd, "function", "column80.repairFunction must be registered");
  let cmdError;
  let cmdSettled = false;
  Promise.resolve()
    .then(() => cmd())
    .then(
      () => { cmdSettled = true; },
      (e) => { cmdError = e; cmdSettled = true; }
    );
  await waitFor(() => cmdSettled, "repairFunction to settle", 1200, true);
  return { cmdError: () => cmdError, settled: () => cmdSettled };
}

// A real project dir + document + function symbols for the repair drives.
const fnSymbolsFor = (text, fnName) => {
  const sig = posOf(text, fnName);
  const lastLine = text.split("\n").length - 1;
  return [
    dsym(
      fnName,
      11, // SymbolKind.Function
      vr(sig.line, 0, Math.min(sig.line + 3, lastLine), 1),
      vr(sig.line, sig.character, sig.line, sig.character + fnName.length)
    ),
  ];
};

const repairFixture = (root, rel, text, fnName) => {
  const abs = path.join(root, rel);
  const uriStr = "file://" + abs;
  const doc = makeDoc(text, uriStr, "typescript");
  const body = posOf(text, "return ");
  return {
    abs,
    doc,
    cursor: new Position(body.line, body.character + 2),
    symbols: fnSymbolsFor(text, fnName),
    docs: { [uriStr]: doc },
  };
};

const baseHandlers = (fix) => ({
  "vscode.executeDocumentSymbolProvider": () => fix.symbols,
  "vscode.executeDefinitionProvider": () => [],
  "vscode.executeHoverProvider": () => [],
  "vscode.executeCompletionItemProvider": () => undefined,
  "vscode.executeCodeActionProvider": () => [],
});

// ===========================================================================
// X1. Qualify for TS: the consent gate. [surface: 'Qualify for TS -
// runQualifyPass wired for TS sessions using the extractor's qualifyImport.
// The edit lands OUTSIDE the accepted span ... it routes through the existing
// presenter consent gate showing the exact edit; no silent application.']
// RED until 4B lands.
// ===========================================================================

const QUALIFY_APP_TS = "export function useSole(): number {\n  return soleExport + 1;\n}\n";
const QUALIFY_IMPORT_TEXT = 'import { soleExport } from "./soleprovider";\n';

gtestX("qualify TS2304: a single-provider import fix is SHOWN through the consent gate, never silently applied [surface: 'Qualify for TS' consent gate]", async () => {
  const root = mkScratch("qualify");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/soleprovider.ts": "export const soleExport: number = 42;\n",
    "src/app.ts": QUALIFY_APP_TS,
  });
  linkRepoTs(root);
  const fix = repairFixture(root, "src/app.ts", QUALIFY_APP_TS, "useSole");
  const before = fs.readFileSync(fix.abs, "utf8");
  const handlers = {
    ...baseHandlers(fix),
    "vscode.executeCodeActionProvider": () => [
      {
        title: 'Add import from "./soleprovider"',
        edit: { entries: () => [[Uri.file(fix.abs), [{ range: vr(0, 0, 0, 0), newText: QUALIFY_IMPORT_TEXT }]]] },
      },
    ],
  };
  const drive = await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers, docs: fix.docs });
  await waitFor(
    () =>
      __state.executeCalls.some((c) => c.id === "vscode.executeCodeActionProvider") &&
      surfacesText().includes("soleprovider"),
    "the qualify consultation and the consent surface",
    400,
    true
  );
  assert.ok(
    __state.executeCalls.some((c) => c.id === "vscode.executeCodeActionProvider"),
    `the extractor's qualifyImport (code-action probe) must be consulted for a TS2304; ${diagX()}`
  );
  assert.ok(
    surfacesText().includes("soleprovider"),
    `the EXACT edit must be shown on a user-visible surface (consent gate), got surfaces:\n${surfacesText()}\n${diagX()}`
  );
  assert.ok(
    !appliedText().includes("soleprovider"),
    `the edit must NOT be applied without consent; applied=${appliedText()}`
  );
  assert.strictEqual(fs.readFileSync(fix.abs, "utf8"), before, "the file on disk is untouched: consent was never given");
  void drive;
});

gtestX("qualify TS2304 ambiguity: two matching providers mean NO qualify offer [surface: phase3 'Deterministic means UNAMBIGUOUS' consumed by 4B - ambiguity/no-fix => no offer]", async () => {
  const root = mkScratch("qualdual");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/dualA.ts": "export const dualExport = 1;\n",
    "src/dualB.ts": "export const dualExport = 2;\n",
    "src/app.ts": "export function useDual(): number {\n  return dualExport + 1;\n}\n",
  });
  linkRepoTs(root);
  const fix = repairFixture(root, "src/app.ts", "export function useDual(): number {\n  return dualExport + 1;\n}\n", "useDual");
  const before = fs.readFileSync(fix.abs, "utf8");
  const dualEdit = (mod) => ({
    title: `Add import from "./${mod}"`,
    edit: { entries: () => [[Uri.file(fix.abs), [{ range: vr(0, 0, 0, 0), newText: `import { dualExport } from "./${mod}";\n` }]]] },
  });
  const handlers = {
    ...baseHandlers(fix),
    "vscode.executeCodeActionProvider": () => [dualEdit("dualA"), dualEdit("dualB")],
  };
  await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers, docs: fix.docs });
  assert.ok(
    !surfacesText().includes("dualA") && !surfacesText().includes("dualB"),
    `an ambiguous fix must never be offered; got surfaces:\n${surfacesText()}`
  );
  assert.ok(!appliedText().includes("dualExport"), "and certainly never applied");
  assert.strictEqual(fs.readFileSync(fix.abs, "utf8"), before, "the file on disk is untouched");
});

// ===========================================================================
// X2. Env surfacing on the EXPLICIT gesture. [surface: 4B amendments 'when an
// EXPLICIT gesture ... cannot run its oracle half for an ENVIRONMENT reason,
// the existing toast/verdict surface states the one-line reason instead of
// nothing'] All four reasons RED until 4B lands.
// ===========================================================================

const ENV_FN_TS = "export function probeEnv(): number {\n  return 1;\n}\n";

gtestX("env surfacing: no tsconfig above the file - the explicit gesture states the reason [surface: 'no tsconfig above the file']", async () => {
  const root = mkScratch("envnocfg");
  writeTree(root, { "src/probe.ts": ENV_FN_TS });
  const fix = repairFixture(root, "src/probe.ts", ENV_FN_TS, "probeEnv");
  await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers: baseHandlers(fix), docs: fix.docs });
  assert.match(
    surfacesText(),
    /tsconfig/i,
    `the reason line names the missing tsconfig on a user-visible surface; got surfaces:\n${surfacesText()}\n${diagX()}`
  );
});

gtestX("env surfacing: no typescript resolvable - the reason names the roots walked [surface: 'no typescript resolvable for the project (names the roots walked)']", async () => {
  const root = mkScratch("envnots");
  writeTree(root, { "tsconfig.json": TS_STRICT_CONFIG, "src/probe.ts": ENV_FN_TS });
  const fix = repairFixture(root, "src/probe.ts", ENV_FN_TS, "probeEnv");
  await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers: baseHandlers(fix), docs: fix.docs });
  const s = surfacesText();
  assert.match(s, /typescript/i, `the reason names the unresolvable typescript; got surfaces:\n${s}\n${diagX()}`);
  assert.ok(s.includes(root), `the reason names the root(s) walked; got surfaces:\n${s}`);
});

gtestX("env surfacing: project tsc crashed - the first stderr line is the evidence [surface: 'project tsc crashed (first stderr line, the Do-8 evidence)']", async () => {
  const root = mkScratch("envcrash");
  const abs = path.join(root, "src", "probe.ts");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/probe.ts": ENV_FN_TS,
    "node_modules/typescript/bin/tsc":
      `const args = process.argv.slice(2);
if (args.indexOf("--listFilesOnly") >= 0) { console.log(${JSON.stringify(abs)}); process.exit(0); }
process.stderr.write("BOOM_TSC_CRASH_SENTINEL: simulated project tsc crash\\n    at Object.<anonymous> (tsc.js:1:1)\\n");
process.exit(1);
`,
  });
  const fix = repairFixture(root, "src/probe.ts", ENV_FN_TS, "probeEnv");
  await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers: baseHandlers(fix), docs: fix.docs });
  assert.ok(
    surfacesText().includes("BOOM_TSC_CRASH_SENTINEL"),
    `the crash reason carries the first stderr line; got surfaces:\n${surfacesText()}\n${diagX()}`
  );
});

gtestX("env surfacing: file not an input of any probed config - the reason names the tsconfig probed [surface: 'file not an input of any found project (names the tsconfig(s) probed)']", async () => {
  const root = mkScratch("envorphan");
  writeTree(root, {
    "tsconfig.json": TS_STRICT_CONFIG,
    "src/index.ts": "export const fine: number = 1;\n",
    "other/lone.ts": ENV_FN_TS,
  });
  linkRepoTs(root);
  const fix = repairFixture(root, "other/lone.ts", ENV_FN_TS, "probeEnv");
  await driveRepair({ doc: fix.doc, cursor: fix.cursor, handlers: baseHandlers(fix), docs: fix.docs });
  assert.match(
    surfacesText(),
    /tsconfig/i,
    `the reason names the probed tsconfig on a user-visible surface; got surfaces:\n${surfacesText()}\n${diagX()}`
  );
});

// ===========================================================================
// X3. Passive paths stay silent. [surface: 'fn-gen/FIM never grow an error
// surface: dark injection degrades silently by design'] GREEN today - freeze.
// ===========================================================================

const envReasonRx = /tsconfig|typescript|\btsc\b/i;

gtestX("passive FIM: a TS document with no tsconfig anywhere completes silently - no env toast, no env decoration [surface: 'FIM keystrokes stay silent']", async () => {
  await harness();
  const root = mkScratch("fimsilent");
  const text = "export const seed = 1;\nexport const next = seed + 1;\n";
  writeTree(root, { "src/quiet.ts": text });
  const abs = path.join(root, "src", "quiet.ts");
  const doc = makeDoc(text, "file://" + abs, "typescript");
  const cursor = new Position(1, "export const next = seed + 1;".length);
  resetDrive({ "vscode.executeDocumentSymbolProvider": () => [] }, { ["file://" + abs]: doc }, makeEditor(doc, cursor));
  serverRef.replyFor = () => "0";
  assert.ok(__state.inlineProviders.length >= 1, "activation registered an inline completion provider");
  const { provider } = __state.inlineProviders[0];
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  await provider.provideInlineCompletionItems(doc, cursor, { triggerKind: 0, selectedCompletionInfo: undefined }, token);
  await waitFor(() => serverRef.requests.some((r) => r.url === "/api/generate"), "a FIM generation request", 200, true);
  assert.strictEqual(
    __state.messages.filter((m) => envReasonRx.test(m.message)).length,
    0,
    `no env-reason toast on the passive FIM path; got ${JSON.stringify(__state.messages)}`
  );
  assert.ok(!envReasonRx.test(JSON.stringify(__state.decorations)), "no env-reason decoration either");
});

gtestX("passive fn-gen: dark injection on a no-tsconfig TS document generates silently - the reason lives in the channel only [surface: 'fn-gen still works dark as v1' + 'the reason lives in the channel']", async () => {
  await harness();
  const root = mkScratch("fngensilent");
  const text = "/** Doubles a count. */\nexport function double(n: number): number {\n\n}\n";
  writeTree(root, { "src/gen.ts": text });
  const abs = path.join(root, "src", "gen.ts");
  const uriStr = "file://" + abs;
  const doc = makeDoc(text, uriStr, "typescript");
  const sig = posOf(text, "export function double");
  const symbols = [
    dsym("double", 11, vr(sig.line, 0, sig.line + 2, 1), vr(sig.line, text.split("\n")[sig.line].indexOf("double"), sig.line, text.split("\n")[sig.line].indexOf("double") + 6)),
  ];
  resetDrive(
    {
      "vscode.executeDocumentSymbolProvider": () => symbols,
      "vscode.executeDefinitionProvider": () => undefined,
      "vscode.executeHoverProvider": () => undefined,
      "vscode.executeCompletionItemProvider": () => undefined,
      "vscode.executeCodeActionProvider": () => undefined,
    },
    { [uriStr]: doc },
    makeEditor(doc, new Position(sig.line + 1, 0))
  );
  serverRef.replyFor = () => "```typescript\nexport function double(n: number): number {\n  return n * 2;\n}\n```";
  const cmd = __state.commands["column80.generateFunction"];
  assert.strictEqual(typeof cmd, "function", "generateFunction must be registered");
  let settled = false;
  Promise.resolve().then(() => cmd()).then(() => { settled = true; }, () => { settled = true; });
  await waitFor(
    () => settled || serverRef.requests.some((r) => r.url === "/api/generate"),
    "a generation request from fn-gen",
    400,
    true
  );
  assert.ok(
    serverRef.requests.some((r) => r.url === "/api/generate"),
    `fn-gen still works dark as v1 (a prompt reached the service); ${diagX()}`
  );
  assert.strictEqual(
    __state.messages.filter((m) => envReasonRx.test(m.message)).length,
    0,
    `no env-reason toast on the passive fn-gen path; got ${JSON.stringify(__state.messages)}`
  );
});
