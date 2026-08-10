// IMPLEMENTATION oracle (LIVE) for session-v29 phase 2: the reference leg,
// against the five REAL language servers.
//
// WHY THIS FILE IS THE DELIVERABLE AND A UNIT TEST IS NOT. Both v29 usage
// experiments are specified on the reference PROVIDER rather than a text search,
// so that an alias, an import rename and a re-export are seen through. That is a
// claim about what five different servers do, not about a mapping function: the
// mapper is proven headless next door (impl-v29-p2-references.test.cjs), and it
// would map a server that answers `null` forever into a perfectly clean `[]`.
// Only a live run can tell "the leg works" from "the leg is silently dark".
//
// The five bars each language is held to, and why each one exists:
//   1. a symbol with known call sites returns them, and every returned range is
//      READ BACK OUT OF THE FILE and must spell the symbol. A location that does
//      not point at the name is worse than no location: the caller slices a
//      window around it and injects the wrong code.
//   2. includeDeclaration:false does not carry the declaration, and the same
//      query with `true` does. Both directions, because a server that ignores
//      the flag entirely passes the first half.
//   3. maxResults truncates.
//   4. a symbol nothing calls returns `[]` and does not throw.
//   5. a cursor on whitespace returns `[]` and does not throw.
//
// Plus the number that decides whether this leg can sit inside the FIM latency
// bar at all: WARM p50/max over 10 calls, on the dogfood repo and, where a
// production repo can be opened read-only, on real code. Reported on the
// diagnostic channel green or red - a run that only prints on failure teaches
// nothing.
//
// PRODUCTION REPOS ARE READ-ONLY. acme-db, the contoso dotnet solution and
// lansura are the human's working trees. Nothing here writes into them: the Rust
// leg redirects CARGO_TARGET_DIR into an OS scratch dir so rust-analyzer's own
// cargo runs never land in the tree, the C# leg only opens projects that already
// carry a restored obj/, and the TS transport is an in-process language service
// that reads and nothing else.
//
// Gated: NOT registered in package.json test:live. A frozen blind test pins that
// list by exact equality, and the blind set is never edited to make something
// pass; whether this file joins the contract is the human's call. Every missing
// toolchain SKIPS - an absent gopls is not a failing contract. SKIP_LIVE=1 skips
// the file.
// Run: node --test --test-concurrency=1 test/impl-v29-p2-references-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
// A cold rust-analyzer index over a real workspace is the long pole (measured
// ~32s on acme-db); a Roslyn cross-project load is the other one.
const LIVE_TIMEOUT = 300_000;
const PROD_TIMEOUT = 900_000;
// Warm latency is measured over this many calls, after the leg has answered once.
const LATENCY_SAMPLES = 10;

const { mod: B, cleanup } = bundleCore(
  "impl-v29-p2-references-live",
  `export { RaLspExtractor } from "../src/core/raLspClient";
export { CsLspExtractor } from "../src/core/csLspExtractor";
export { TsLsExtractor } from "../src/core/tsLsExtractor";
export { PyLspExtractor } from "../src/core/pyLspExtractor";
export { GoLspExtractor } from "../src/core/goLspExtractor";\n`,
);
test.after(cleanup);

const HOME = os.homedir();
const GOPLS = path.join(HOME, "go", "bin", "gopls");
const PYRIGHT = path.join(__dirname, "..", "node_modules", ".bin", "pyright-langserver");
const ROSLYN_DLL = path.join(
  HOME,
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll",
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uriOf = (p) => pathToFileURL(p).href;
const exists = (p) => fs.existsSync(p);

const onPath = (bin) => {
  try {
    execFileSync(bin, ["--version"], { timeout: 30_000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// ===========================================================================
// Harness. Sites are LOCATED in the file text, never written down as line
// numbers: the dogfood playgrounds are the human's and they get edited.
// ===========================================================================

/** The cursor INSIDE `needle`, on the first line containing `lineNeedle`.
 *  Inside, not before: a reference provider resolves the symbol under the
 *  cursor, and a cursor one column early sits on the space. */
function siteOf(text, lineNeedle, needle) {
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    if (!lines[line].includes(lineNeedle)) {
      continue;
    }
    const at = lines[line].indexOf(needle);
    if (at >= 0) {
      return { line, character: at + 1 };
    }
  }
  assert.fail(`no line of the fixture contains ${JSON.stringify(lineNeedle)}; the playground moved under this test`);
}

/** The first wholly EMPTY line: bar 5's cursor-on-nothing. A blank line, not
 *  column 0 of a comment, so the case is "no symbol here" and not "a symbol the
 *  server happens to ignore". */
function blankSite(text) {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => l.length === 0);
  assert.ok(line >= 0, "the fixture must carry a blank line for the cursor-on-nothing bar");
  return { line, character: 0 };
}

const fileCache = new Map();
function textOf(uri) {
  const p = fileURLToPath(uri);
  if (!fileCache.has(p)) {
    fileCache.set(p, fs.readFileSync(p, "utf8"));
  }
  return fileCache.get(p);
}

/** The bytes a returned location points at. This is bar 1: the answer is only
 *  worth anything if the range spells the symbol in the file on disk. */
function textAt(loc) {
  const lines = textOf(loc.uri).split("\n");
  if (loc.line !== loc.endLine) {
    return `<multi-line ${loc.line}..${loc.endLine}>`;
  }
  return (lines[loc.line] ?? "").slice(loc.character, loc.endCharacter);
}

/** The whole line a location sits on, which is how bar 2 recognizes a
 *  DECLARATION without this test having to know where the declaration lives. */
function lineAt(loc) {
  return textOf(loc.uri).split("\n")[loc.line] ?? "";
}

const show = (locs) =>
  locs.length === 0
    ? "(none)"
    : locs.map((l) => `${path.basename(fileURLToPath(l.uri))}:${l.line + 1}:${l.character} ${JSON.stringify(textAt(l))}`).join("  ");

const sameSpot = (a, b) => a.uri === b.uri && a.line === b.line && a.character === b.character;

/** Warm p50/max over LATENCY_SAMPLES calls. The first call is NOT in the sample:
 *  it pays for whatever index the server builds lazily, and the number the FIM
 *  bar cares about is the one a human gets on their second keystroke. */
async function warmLatency(query) {
  await query();
  const ms = [];
  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const t = Date.now();
    await query();
    ms.push(Date.now() - t);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  return { p50: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], all: ms };
}

/** Poll the primary query until the server has something to say. Bounded, and
 *  the LAST answer is what the bars read, so a server that never answers reports
 *  the empty set it really produced rather than hanging.
 *
 *  This lives in the TEST, not in the transport, on purpose: `[]` is also the
 *  honest answer for a symbol nobody calls, so a retry loop inside the leg would
 *  spend a second of the caller's window on every first-use symbol to learn
 *  nothing. Here the test knows the symbol HAS call sites, so waiting is sound. */
async function settle(ex, cursor, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let locs = [];
  for (;;) {
    locs = await ex.references(cursor);
    if (locs.length > 0 || Date.now() > deadline) {
      return locs;
    }
    await sleep(500);
  }
}

/**
 * The five bars, run against one live extractor. `cfg`:
 *   askUri/askSite    a cursor ON a symbol with known call sites (its
 *                     declaration or any use; the provider resolves either)
 *   symbol            the name every returned range must spell
 *   minRefs           how many call sites the workspace really holds
 *   declLineNeedle    what the DECLARATION's line reads like, so bar 2 can
 *                     recognize it wherever the server says it lives - this test
 *                     never writes a declaration's coordinates down
 *   unusedUri/Site    the declaration of a symbol nothing calls
 *   blankUri/Site     a cursor on nothing
 */
async function proveReferences(ctx, ex, cfg) {
  const askCursor = { uri: cfg.askUri, ...cfg.askSite };

  // ---- bar 1: real call sites, and every range spells the symbol.
  const uses = await settle(ex, askCursor, cfg.settleMs ?? 20_000);
  ctx.diagnostic(`${cfg.lang} uses of ${cfg.symbol} (n=${uses.length}): ${show(uses)}`);
  assert.ok(
    uses.length >= cfg.minRefs,
    `${cfg.lang}: the workspace calls ${cfg.symbol} at ${cfg.minRefs} sites at least; the provider found ${uses.length}. ` +
      `An empty or short answer here is the leg being silently dark, which is the exact failure a mapping unit test cannot see.\n  GOT: ${show(uses)}`,
  );
  for (const loc of uses) {
    assert.strictEqual(
      textAt(loc),
      cfg.symbol,
      `${cfg.lang}: every returned range must spell ${JSON.stringify(cfg.symbol)} in the file on disk; ` +
        `a caller slices its usage window around this range, so a range that points elsewhere injects the wrong code.\n  AT: ${path.basename(fileURLToPath(loc.uri))}:${loc.line + 1}:${loc.character}-${loc.endCharacter}\n  ALL: ${show(uses)}`,
    );
  }

  // ---- bar 2: includeDeclaration, both directions. The difference between the
  // two answers IS the declaration, so the flag is proven by what turning it on
  // ADDS rather than against a coordinate written down here. A server that
  // ignores the flag adds nothing and fails; one that always omits the
  // declaration adds nothing and fails too.
  const withDecl = await ex.references(askCursor, { includeDeclaration: true });
  ctx.diagnostic(`${cfg.lang} includeDeclaration:true (n=${withDecl.length}): ${show(withDecl)}`);
  const extra = withDecl.filter((l) => !uses.some((u) => sameSpot(u, l)));
  assert.strictEqual(
    extra.length,
    1,
    `${cfg.lang}: includeDeclaration:true must add exactly one location - the declaration - to the default answer.\n` +
      `  DEFAULT (n=${uses.length}): ${show(uses)}\n  WITH DECLARATION (n=${withDecl.length}): ${show(withDecl)}`,
  );
  assert.strictEqual(textAt(extra[0]), cfg.symbol, `${cfg.lang}: the added location must spell the symbol.\n  AT: ${show(extra)}`);
  assert.ok(
    lineAt(extra[0]).includes(cfg.declLineNeedle),
    `${cfg.lang}: the location includeDeclaration:true adds must be the DECLARATION, whose line reads ` +
      `${JSON.stringify(cfg.declLineNeedle)}; anything else means the flag bought a usage rather than the declaration.\n` +
      `  ADDED: ${show(extra)}\n  ITS LINE: ${JSON.stringify(lineAt(extra[0]))}`,
  );

  // ---- bar 3: maxResults truncates, after the server answered.
  const capped = await ex.references(askCursor, { maxResults: 2 });
  assert.strictEqual(
    capped.length,
    2,
    `${cfg.lang}: maxResults:2 must truncate a ${uses.length}-hit answer to 2.\n  GOT: ${show(capped)}`,
  );
  for (const loc of capped) {
    assert.ok(
      uses.some((u) => sameSpot(u, loc)),
      `${cfg.lang}: truncation must keep locations the untruncated answer held, not invent or reorder into new ones.\n  CAPPED: ${show(capped)}\n  FULL: ${show(uses)}`,
    );
  }

  // ---- bar 4: a symbol nothing calls is empty, and does not throw.
  const unused = await ex.references({ uri: cfg.unusedUri, ...cfg.unusedSite });
  assert.deepStrictEqual(
    unused,
    [],
    `${cfg.lang}: ${cfg.unusedSymbol} is declared and never called, so the leg owes an empty list and no throw - that is ` +
      `the first-use case both v29 experiments have to survive.\n  GOT: ${show(unused)}`,
  );

  // ---- bar 5: a cursor on nothing is empty, and does not throw.
  const nothing = await ex.references({ uri: cfg.blankUri, ...cfg.blankSite });
  assert.deepStrictEqual(
    nothing,
    [],
    `${cfg.lang}: a cursor on a blank line resolves no symbol, so the leg owes an empty list and no throw.\n  GOT: ${show(nothing)}`,
  );

  // ---- the number the FIM bar is decided on.
  const lat = await warmLatency(() => ex.references(askCursor));
  ctx.diagnostic(`${cfg.lang} WARM references p50=${lat.p50}ms max=${lat.max}ms samples=[${lat.all.join(",")}]`);
  return lat;
}

/** Every guard skips. A toolchain that is not installed is not a broken leg. */
const gtest = (name, opts, guards, fn) =>
  test(name, opts, async (ctx) => {
    if (SKIP) {
      return ctx.skip(SKIP);
    }
    for (const g of guards()) {
      if (g) {
        return ctx.skip(g);
      }
    }
    return fn(ctx);
  });

// ===========================================================================
// Rust: rust-analyzer over ~/repos/rust-scratch.
// ===========================================================================

const RUST_ROOT = path.join(HOME, "repos", "rust-scratch");
const RUST_ATLAS = path.join(RUST_ROOT, "crates", "atlas", "src", "lib.rs");

gtest(
  "rust: rust-analyzer answers references at a cross-crate method, honors includeDeclaration, truncates, and is empty where it should be",
  { timeout: LIVE_TIMEOUT },
  () => [
    !exists(RUST_ATLAS) && `rust-scratch fixture not found at ${RUST_ATLAS}`,
    !onPath("rust-analyzer") && "rust-analyzer is not runnable on PATH",
  ],
  async (ctx) => {
    // Vendored deps only; indexing must not reach the network.
    process.env.CARGO_NET_OFFLINE = "true";
    const ex = await B.RaLspExtractor.start({ workspaceRoot: RUST_ROOT });
    try {
      const uri = uriOf(RUST_ATLAS);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      await ex.whenReady(LIVE_TIMEOUT / 2);
      await proveReferences(ctx, ex, {
        lang: "rust",
        askUri: uri,
        askSite: siteOf(text, "pub fn subtended_children", "subtended_children"),
        symbol: "subtended_children",
        // atlas's own aggregate_fanout, playground's fim.rs, and two in
        // autocontext.rs. Cross-CRATE, which is the half a per-file walk misses.
        minRefs: 4,
        declLineNeedle: "pub fn subtended_children",
        // Declared, named in a sibling method's doc comment, called nowhere -
        // so this also proves the provider is not a word search.
        unusedUri: uri,
        unusedSite: siteOf(text, "pub fn partition_by_lod", "partition_by_lod"),
        unusedSymbol: "partition_by_lod",
        blankUri: uri,
        blankSite: blankSite(text),
      });
    } finally {
      ex.dispose();
    }
  },
);

// ===========================================================================
// Go: gopls over ~/repos/go-scratch.
// ===========================================================================

const GO_ROOT = path.join(HOME, "repos", "go-scratch");
const GO_ATLAS = path.join(GO_ROOT, "atlas", "atlas.go");
const GO_MAIN = path.join(GO_ROOT, "playground", "main.go");

gtest(
  "go: gopls answers references at a cross-package method, honors includeDeclaration, truncates, and is empty where it should be",
  { timeout: LIVE_TIMEOUT },
  () => [!exists(GO_ATLAS) && `go-scratch fixture not found at ${GO_ATLAS}`, !exists(GOPLS) && `gopls not found at ${GOPLS}`],
  async (ctx) => {
    const ex = await B.GoLspExtractor.start({ projectRoot: GO_ROOT, goplsPath: GOPLS });
    try {
      const uri = uriOf(GO_ATLAS);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      // gopls resolves a cross-package query out of the package it loaded for the
      // open file, so the caller's file has to be open too.
      const mainUri = uriOf(GO_MAIN);
      const mainText = textOf(mainUri);
      ex.openDocument(mainUri, mainText);
      await ex.whenReady(LIVE_TIMEOUT / 2);
      await proveReferences(ctx, ex, {
        lang: "go",
        askUri: uri,
        askSite: siteOf(text, "func (t Tile) SubtendedChildren", "SubtendedChildren"),
        symbol: "SubtendedChildren",
        minRefs: 3,
        declLineNeedle: "func (t Tile) SubtendedChildren",
        // `main` is declared for the runtime, never called from source: the
        // language's own zero-reference symbol, and the only one go-scratch has
        // (every atlas export is exercised by the playground).
        unusedUri: mainUri,
        unusedSite: siteOf(mainText, "func main()", "main"),
        unusedSymbol: "main",
        blankUri: uri,
        blankSite: blankSite(text),
      });
    } finally {
      ex.dispose();
    }
  },
);

// ===========================================================================
// Python: pyright-langserver over ~/repos/python-scratch.
// ===========================================================================

const PY_ROOT = path.join(HOME, "repos", "python-scratch");
const PY_CORE = path.join(PY_ROOT, "atlas_py", "_core.py");

gtest(
  "python: pyright answers references at a cross-module method, honors includeDeclaration, truncates, and is empty where it should be",
  { timeout: LIVE_TIMEOUT },
  () => [
    !exists(PY_CORE) && `python-scratch fixture not found at ${PY_CORE}`,
    !exists(PYRIGHT) && `pyright-langserver not found at ${PYRIGHT}`,
  ],
  async (ctx) => {
    const ex = await B.PyLspExtractor.start({ projectRoot: PY_ROOT, serverPath: PYRIGHT, server: PYRIGHT });
    try {
      const uri = uriOf(PY_CORE);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      await ex.whenReady(LIVE_TIMEOUT / 2);
      await proveReferences(ctx, ex, {
        lang: "python",
        askUri: uri,
        askSite: siteOf(text, "def subtended_children", "subtended_children"),
        symbol: "subtended_children",
        minRefs: 4,
        declLineNeedle: "def subtended_children",
        // Declared, named in a sibling method's docstring, called nowhere - so
        // this also proves the provider is not a word search.
        unusedUri: uri,
        unusedSite: siteOf(text, "def enroll_batch", "enroll_batch"),
        unusedSymbol: "enroll_batch",
        blankUri: uri,
        blankSite: blankSite(text),
      });
    } finally {
      ex.dispose();
    }
  },
);

// ===========================================================================
// TypeScript: the in-process language service over ~/repos/ts-scratch/playground.
//
// PROGRAM, not workspace: the extractor sees the playground tsconfig's files
// plus what they import, which is how the cross-package declaration in
// packages/atlas-ts is reachable at all. A sibling app of the monorepo is not.
//
// THE CURSOR SITS AT A USE SITE, not at the cross-package declaration, and that
// is a transport property worth knowing rather than a convenience. The program
// resolved `@scratch/atlas-ts` through the node_modules symlink and holds the
// file under THAT path, so a cursor addressed at packages/atlas-ts/src/index.ts
// names a file the program has never heard of and every primitive on this
// transport degrades to empty for it. The provider still REPORTS the declaration
// under the path it knows, which is what bar 2 reads.
// ===========================================================================

const TS_ROOT = path.join(HOME, "repos", "ts-scratch", "playground");
const TS_REPAIR = path.join(TS_ROOT, "src", "repair.ts");

gtest(
  "typescript: the TS language service answers references at a cross-package method, honors includeDeclaration, truncates, and is empty where it should be",
  { timeout: LIVE_TIMEOUT },
  () => [!exists(TS_REPAIR) && `ts-scratch playground not found at ${TS_REPAIR}`],
  async (ctx) => {
    const ex = await B.TsLsExtractor.start({ projectRoot: TS_ROOT });
    try {
      const uri = uriOf(TS_REPAIR);
      const text = textOf(uri);
      await ex.whenReady();
      await proveReferences(ctx, ex, {
        lang: "typescript",
        askUri: uri,
        askSite: siteOf(text, "return tileFromMorton(code, 2).subtendedChildren", "subtendedChildren"),
        symbol: "subtendedChildren",
        minRefs: 5,
        declLineNeedle: "subtendedChildren(): number",
        // Exported from this file and imported by nobody: the first-use shape.
        unusedUri: uri,
        unusedSite: siteOf(text, "export function hallucinatedMember", "hallucinatedMember"),
        unusedSymbol: "hallucinatedMember",
        blankUri: uri,
        blankSite: blankSite(text),
      });
    } finally {
      ex.dispose();
    }
  },
);

// ===========================================================================
// C#: the Roslyn language server over ~/repos/csharp-scratch.
// ===========================================================================

const CS_ROOT = path.join(HOME, "repos", "csharp-scratch");
const CS_ATLAS = path.join(CS_ROOT, "src", "Atlas", "Atlas.cs");
const CS_PROJECTS = [
  path.join(CS_ROOT, "src", "Playground", "Playground.csproj"),
  path.join(CS_ROOT, "src", "Atlas", "Atlas.csproj"),
];

gtest(
  "csharp: Roslyn answers references at a cross-project method, honors includeDeclaration, truncates, and is empty where it should be",
  { timeout: LIVE_TIMEOUT },
  () => [
    !exists(CS_ATLAS) && `csharp-scratch fixture not found at ${CS_ATLAS}`,
    !exists(ROSLYN_DLL) && `Roslyn LS not found at ${ROSLYN_DLL}`,
    !onPath("dotnet") && "dotnet is not runnable on PATH",
  ],
  async (ctx) => {
    // Both projects: Roslyn only searches what project/open loaded, so a
    // single-project load is the shape that reads a cross-project call site as
    // no call site at all.
    const ex = await B.CsLspExtractor.start({
      projectRoot: CS_ROOT,
      csproj: CS_PROJECTS.map(uriOf),
      serverDll: ROSLYN_DLL,
    });
    try {
      await ex.whenReady(LIVE_TIMEOUT / 2);
      const uri = uriOf(CS_ATLAS);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      await proveReferences(ctx, ex, {
        lang: "csharp",
        askUri: uri,
        askSite: siteOf(text, "public int SubtendedChildren", "SubtendedChildren"),
        symbol: "SubtendedChildren",
        minRefs: 4,
        declLineNeedle: "public int SubtendedChildren",
        unusedUri: uri,
        unusedSite: siteOf(text, "public bool Encloses", "Encloses"),
        unusedSymbol: "Encloses",
        blankUri: uri,
        blankSite: blankSite(text),
        // The cross-project load settles after projectInitializationComplete, so
        // the first query can precede the index by a second or two.
        settleMs: 60_000,
      });
    } finally {
      ex.dispose();
    }
  },
);

// ===========================================================================
// Production repos. READ ONLY, and the point is the LATENCY: a dogfood
// playground is a few hundred lines, and a number measured there is not evidence
// about a repo the human actually works in.
// ===========================================================================

const PROD_RUST = "/home/utilitydelta/work/acme/acme-db";
const PROD_CS = "/home/utilitydelta/work/contoso/data-processing/dotnet";
const PROD_TS = "/home/utilitydelta/work/acme/acme-fe-apps/apps/lansura";

gtest(
  "production rust (acme-db): warm references latency at a real call site",
  { timeout: PROD_TIMEOUT },
  () => [!exists(PROD_RUST) && `acme-db not found at ${PROD_RUST}`, !onPath("rust-analyzer") && "rust-analyzer is not runnable on PATH"],
  async (ctx) => {
    // The one write rust-analyzer would otherwise make into the human's tree:
    // its cargo runs land in target/. Redirect them into a scratch dir so the
    // repo is read-only in fact and not just in intent.
    const previous = process.env.CARGO_TARGET_DIR;
    process.env.CARGO_TARGET_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "v29-ra-target-"));
    const file = path.join(PROD_RUST, "acme", "src", "api_keys.rs");
    if (!exists(file)) {
      return ctx.skip(`acme-db moved api_keys.rs; nothing to measure at ${file}`);
    }
    const ex = await B.RaLspExtractor.start({ workspaceRoot: PROD_RUST });
    try {
      const uri = uriOf(file);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      const cold = Date.now();
      await ex.whenReady(PROD_TIMEOUT / 2);
      ctx.diagnostic(`production rust cold index: ${Date.now() - cold}ms`);
      const cursor = { uri, ...siteOf(text, "pub fn load_api_keys", "load_api_keys") };
      const first = Date.now();
      const uses = await settle(ex, cursor, 60_000);
      ctx.diagnostic(`production rust first call ${Date.now() - first}ms, n=${uses.length}`);
      assert.ok(uses.length > 0, `load_api_keys is called in acme-db; the provider found nothing`);
      for (const loc of uses) {
        assert.strictEqual(textAt(loc), "load_api_keys", `every range must spell the symbol\n  ALL: ${show(uses)}`);
      }
      const lat = await warmLatency(() => ex.references(cursor));
      ctx.diagnostic(`production rust WARM p50=${lat.p50}ms max=${lat.max}ms samples=[${lat.all.join(",")}]`);
    } finally {
      ex.dispose();
      if (previous === undefined) {
        delete process.env.CARGO_TARGET_DIR;
      } else {
        process.env.CARGO_TARGET_DIR = previous;
      }
    }
  },
);

gtest(
  "production csharp (contoso dotnet): warm references latency at a real interface member",
  { timeout: PROD_TIMEOUT },
  () => [!exists(PROD_CS) && `contoso dotnet solution not found at ${PROD_CS}`, !exists(ROSLYN_DLL) && `Roslyn LS not found at ${ROSLYN_DLL}`, !onPath("dotnet") && "dotnet is not runnable on PATH"],
  async (ctx) => {
    const projects = [
      path.join(PROD_CS, "Contoso.ProcessingLogic", "Contoso.ProcessingLogic.csproj"),
      path.join(PROD_CS, "Contoso.DataProcessing", "Contoso.DataProcessing.csproj"),
      path.join(PROD_CS, "Contoso.ProcessingLogic.Tests", "Contoso.ProcessingLogic.Tests.csproj"),
    ];
    const file = path.join(PROD_CS, "Contoso.ProcessingLogic", "Interface", "IDpmInterpolation.cs");
    const unrestored = projects.filter((p) => !exists(path.join(path.dirname(p), "obj", "project.assets.json")));
    if (!exists(file) || projects.some((p) => !exists(p))) {
      return ctx.skip(`the contoso solution moved; nothing to measure at ${file}`);
    }
    // The read-only bar: a project with no restored obj/ would make Roslyn's
    // design-time build write into the human's tree. Skip rather than write.
    if (unrestored.length > 0) {
      return ctx.skip(`not restored, and this test never writes into a production repo: ${unrestored.map((p) => path.basename(p)).join(", ")}`);
    }
    const ex = await B.CsLspExtractor.start({ projectRoot: PROD_CS, csproj: projects.map(uriOf), serverDll: ROSLYN_DLL });
    try {
      const ready = Date.now();
      await ex.whenReady(PROD_TIMEOUT / 2);
      ctx.diagnostic(`production csharp project load: ${Date.now() - ready}ms`);
      const uri = uriOf(file);
      const text = textOf(uri);
      ex.openDocument(uri, text);
      const cursor = { uri, ...siteOf(text, "Task AddInterpolatedDataToCloud", "AddInterpolatedDataToCloud") };
      const first = Date.now();
      const uses = await settle(ex, cursor, 90_000);
      ctx.diagnostic(`production csharp first non-empty after ${Date.now() - first}ms, n=${uses.length}: ${show(uses)}`);
      if (uses.length === 0) {
        // Which of the two things happened is the whole question, and an empty
        // answer alone cannot say. `projectInitializationComplete` is NOT the
        // signal that a big solution's semantic model is queryable: measured on
        // this repo, the same query answered 2, 3 and 0 hits across runs, and 0
        // reproduced whenever a rust-analyzer index over acme-db had just
        // run in the same process and was still eating the box. So ask Roslyn
        // something ELSE at the same cursor. A server that cannot hover its own
        // open file never loaded, and a latency measurement against a server
        // that never loaded is not a finding - it is noise, and skipping says so
        // out loud. A server that hovers but will not answer references is the
        // leg being broken, and that still fails.
        const alive = await ex.hoverSurface(cursor);
        if (alive === undefined) {
          return ctx.skip(
            "Roslyn never served this file: hover at the same cursor is empty too, so the solution did not finish loading and " +
              "there is no latency here to measure. Run this measurement on an idle box, one production repo at a time.",
          );
        }
        assert.fail(
          `Roslyn hovers this cursor (${JSON.stringify(alive.signature)}) but returns no references for AddInterpolatedDataToCloud, ` +
            `which the solution calls. The server is loaded and the reference leg is dark.`,
        );
      }
      const lat = await warmLatency(() => ex.references(cursor));
      ctx.diagnostic(`production csharp WARM p50=${lat.p50}ms max=${lat.max}ms samples=[${lat.all.join(",")}]`);
    } finally {
      ex.dispose();
    }
  },
);

gtest(
  "production typescript (lansura): warm references latency at a real domain selector",
  { timeout: PROD_TIMEOUT },
  () => [!exists(PROD_TS) && `lansura not found at ${PROD_TS}`],
  async (ctx) => {
    const file = path.join(PROD_TS, "src", "domain", "selectors.ts");
    if (!exists(file)) {
      return ctx.skip(`lansura moved selectors.ts; nothing to measure at ${file}`);
    }
    const prime = Date.now();
    const ex = await B.TsLsExtractor.start({ projectRoot: PROD_TS });
    try {
      ctx.diagnostic(`production typescript program prime: ${Date.now() - prime}ms`);
      const uri = uriOf(file);
      const text = textOf(uri);
      const cursor = { uri, ...siteOf(text, "export function orderedChildren", "orderedChildren") };
      const first = Date.now();
      const uses = await ex.references(cursor);
      ctx.diagnostic(`production typescript first call ${Date.now() - first}ms, n=${uses.length}`);
      assert.ok(uses.length > 0, "orderedChildren is called across lansura; the provider found nothing");
      for (const loc of uses) {
        assert.strictEqual(textAt(loc), "orderedChildren", `every range must spell the symbol\n  ALL: ${show(uses)}`);
      }
      const lat = await warmLatency(() => ex.references(cursor));
      ctx.diagnostic(`production typescript WARM p50=${lat.p50}ms max=${lat.max}ms samples=[${lat.all.join(",")}]`);
    } finally {
      ex.dispose();
    }
  },
);
