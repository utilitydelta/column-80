// BLIND ORACLE — session-v21 phase 3b: the WHOLE-BLOCK injection site (cursor in
// an empty function body, goal item 8), across Python / TypeScript / C#.
//
// Contract under test: session-v21/surface-p3b.md (the settled promise). §0's
// corrected budget is 1200 chars = DATASHAPE_TOTAL_TOK(300) * 4 (NOT 1600).
// This file NEVER opens the body of a function under test; it drives the settled,
// exported surface with fakes and asserts the CONTRACT INVARIANTS, not the
// mechanism the implementer is free to choose. The current implementation carries
// the defects the contract forbids, so a faithful contract test runs RED today.
//
//   §1 Python  — a type with renderable methods must show >=1 callable, not every
//                slot spent on fields (membersWithHoverSignatures); and a cold
//                cross-file type whose sole signed member is the constructor must
//                not resolve to ZERO methods when a settle would have shown them
//                (resolveCrossFileShape + renderMethods drop).
//   §2 TS      — a >8-member type shows MORE than 8 signed members when allowed;
//                HOVER_SIGNATURE_CAP=8 is the product's own constant leaking into
//                the surface. Bounded downstream by the 1200-char budget, never
//                uncapped.
//   §3 C#      — renderWholeBlockInjection's TOTAL length (header + every `// `
//                prefix included) is within tokenBudget; a member line in a
//                multi-type block is attributable to its owning type; the function
//                being written is not listed as a type in play.
//
// Surfaces driven (exported signatures + this scaffolding only, never bodies):
//   fimWholeBlock.ts : renderWholeBlockInjection, createInjectionCache,
//                      csWholeBlockSite, wholeBlockSiteFor
//   extraction.ts    : membersWithHoverSignatures, HOVER_SIGNATURE_CAP
//   crossFileShape.ts: resolveCrossFileShape, pyShapeHooks, isConstructionMember
//
// Run: node --test test/blind-v21-p3b.test.cjs
// Expected: RED — today's code overruns the budget, caps TS at 8, spends every
// Python slot on fields, and cold-drops a sole-constructor type to zero methods.

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v21-p3b",
    `export { renderWholeBlockInjection, createInjectionCache, csWholeBlockSite, wholeBlockSiteFor } from "../src/core/fimWholeBlock";
export { membersWithHoverSignatures, HOVER_SIGNATURE_CAP } from "../src/core/extraction";
export { resolveCrossFileShape, pyShapeHooks, isConstructionMember } from "../src/core/crossFileShape";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());

const {
  renderWholeBlockInjection,
  createInjectionCache,
  csWholeBlockSite,
  wholeBlockSiteFor,
  membersWithHoverSignatures,
  HOVER_SIGNATURE_CAP,
  resolveCrossFileShape,
  pyShapeHooks,
  isConstructionMember,
} = mod;

test("bundle guard: the p3b surface bundles headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// The 2-D walk bound. TOK_MAX is set high so ONLY the aggregate `tokenBudget`
// (the shared char budget) binds a block in the §3 tests — the contract is about
// that aggregate, not the per-walk cap.
const BOUNDS = { D_MAX: 4, B_MAX: 8, N_MAX: 32, TOK_MAX: 100000 };

// ===========================================================================
// Shared fakes for membersWithHoverSignatures (§1a, §2).
//
// Models a server that leaves documentSymbol `detail` empty (TS + Python): every
// member starts signature-less and must be BACKFILLED by a hover fan-out, which
// the cap bounds. `role` is identity (the fake symbol's `kind` is already a
// SymbolRole string); `build` mirrors a language builder (bare name until a
// non-empty hover string is spliced in); `hoverSignatureAt` answers instantly and
// in-budget, keyed by the member's own line, with a signature that names it.
// ===========================================================================

const roleId = (kind) => kind;
const buildMember = (label, detail, kind) => ({
  name: label,
  kind,
  signature: typeof detail === "string" && detail.length > 0 ? detail : undefined,
});

// A container symbol enclosing `fields` (declared FIRST) then `methods`, each a
// detail-less member node at its own line. Returns the driver inputs.
function memberType(typeName, fields, methods) {
  const members = [];
  const sigByLine = new Map();
  let line = 1;
  const push = (name, kind) => {
    const ln = line++;
    members.push({
      name,
      kind,
      range: { start: { line: ln, character: 0 }, end: { line: ln, character: 60 } },
      selectionRange: { start: { line: ln, character: 8 }, end: { line: ln, character: 8 + name.length } },
    });
    sigByLine.set(ln, kind === "field" ? `${name}: int` : `${name}(self) -> int`);
  };
  for (const f of fields) push(f, "field");
  for (const m of methods) push(m, "method");
  const container = {
    name: typeName,
    kind: "container",
    range: { start: { line: 0, character: 0 }, end: { line: 100000, character: 0 } },
    children: members,
  };
  return {
    symbols: [container],
    // The cursor sits in the container's own header line, inside no member's range.
    cursor: { uri: "file:///w", line: 0, character: 6 },
    hoverSignatureAt: async (at) => sigByLine.get(at.line),
  };
}

const signed = (members) => members.filter((m) => m.signature !== undefined);
const signedMethods = (members) => members.filter((m) => m.kind === "method" && m.signature !== undefined);

// ===========================================================================
// §1(a) Python — a type with callables must not spend every bounded slot on
//         fields. surface-p3b §1: "a callable and a field compete for the same
//         slots and the callables cannot always lose."
//
// INVARIANT (mechanism-free): at a type with fields AND methods where every
// member's signature is backfillable, at least one CALLABLE is among the signed
// members. NOT asserted: any particular order, nor which members win — only that
// the callables do not ALL lose to declaration order.
// ===========================================================================

test("§1a: 8 fields declared before 8 methods — at least one method is still signed (callables cannot all lose the cap)", async () => {
  const fields = Array.from({ length: 8 }, (_, i) => `attr${i}`);
  const methods = Array.from({ length: 8 }, (_, i) => `method${i}`);
  const t = memberType("Widget", fields, methods);

  const out = await membersWithHoverSignatures(t.symbols, t.cursor, roleId, buildMember, t.hoverSignatureAt);

  // Sanity: the type genuinely has callables to show.
  assert.strictEqual(out.filter((m) => m.kind === "method").length, 8, "the fake type has 8 methods");
  assert.ok(
    signedMethods(out).length >= 1,
    `a type with 8 callables must show >=1 signed callable; every slot went to fields instead. ` +
      `signed methods=${signedMethods(out).length}, signed fields=${signed(out).filter((m) => m.kind === "field").length}`,
  );
});

test("§1a: even a fields-heavy type (12 fields, 4 methods) surfaces a callable, not an all-field block", async () => {
  const fields = Array.from({ length: 12 }, (_, i) => `f${i}`);
  const methods = Array.from({ length: 4 }, (_, i) => `call${i}`);
  const t = memberType("Widget", fields, methods);

  const out = await membersWithHoverSignatures(t.symbols, t.cursor, roleId, buildMember, t.hoverSignatureAt);
  assert.ok(
    signedMethods(out).length >= 1,
    `a method-recall block must carry at least one callable; got 0 signed callables out of 4 (all ${signed(out).length} slots on fields)`,
  );
});

// ===========================================================================
// §1(b) Python cold-zero — a cross-file type whose warm walk renders N methods
//         must not resolve to ZERO methods on the touch that opens its def file,
//         when the ONLY reason is the fan-out cut left the constructor as the sole
//         survivor and renderMethods drops it. surface-p3b §1: "emit what a settle
//         would have shown ... a type with seven renderable methods must not read
//         as a type with none."
//
// The extractor answers COLD on the first membersOfType touch (only __init__
// resolved) and WARM afterwards (the seven methods). Today the settle re-poll
// fires only on an EMPTY member set (length 0), so a length-1 [__init__] never
// re-polls; renderMethods then drops __init__ -> methods === []. A fix that
// re-settles (or otherwise refuses to read a sole-constructor survivor as zero)
// reaches the warm seven. INTERPRETATION: this pins the "emit what a settle would
// have shown" branch of the two the contract allows.
// ===========================================================================

const PY_BOUND = { D_MAX: 2, N_MAX: 8 };
const DEF_LOC = { uri: "file:///widget.py", range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 12 } };
const ROOT_SITE = { uri: "file:///main.py", line: 0, character: 0 };
const openFile = async (uri) => (uri === ROOT_SITE.uri ? "Widget" : "class Widget:\n    pass\n");

const warmMethods = () =>
  Array.from({ length: 7 }, (_, i) => ({ name: `render${i}`, kind: "method", signature: `render${i}(self) -> int` }));
const soleConstructor = () => [{ name: "__init__", kind: "method", signature: "__init__(self, size: int) -> None" }];

function pyExtractor(memberSequence) {
  let call = 0;
  return {
    definition: async () => DEF_LOC,
    hoverSurface: async () => ({ signature: "class Widget" }),
    membersOfType: async () => memberSequence[Math.min(call++, memberSequence.length - 1)],
  };
}

test("§1b control: a WARM cross-file Python type renders its 7 methods (fake + pipeline are sound)", async () => {
  const shape = await resolveCrossFileShape(pyExtractor([warmMethods()]), ROOT_SITE, PY_BOUND, openFile, pyShapeHooks);
  const widget = shape.types.get("Widget");
  assert.ok(widget, "Widget resolves warm");
  assert.strictEqual(widget.methods.length, 7, `warm walk renders all 7 methods; got ${JSON.stringify(widget.methods)}`);
});

test("§1b: a COLD touch whose sole survivor is __init__ must NOT resolve to zero methods (a 7-method type must not read as none)", async () => {
  // Cold first (only __init__), warm on any re-touch (the seven a settle finds).
  const shape = await resolveCrossFileShape(
    pyExtractor([soleConstructor(), warmMethods()]),
    ROOT_SITE,
    PY_BOUND,
    openFile,
    pyShapeHooks,
  );
  const widget = shape.types.get("Widget");
  assert.ok(widget, "Widget resolves (hover carried the type)");
  assert.ok(
    widget.methods.length >= 1,
    `the sole-constructor survivor must not read as a method-less type — a settle would show 7. ` +
      `renderMethods dropped __init__ and left ${JSON.stringify(widget.methods)}`,
  );
});

test("§1b regression: isConstructionMember still recognizes the three construction spellings", () => {
  assert.strictEqual(isConstructionMember("__init__", "Widget"), true, "python __init__");
  assert.strictEqual(isConstructionMember("constructor", "Widget"), true, "ts/js constructor");
  assert.strictEqual(isConstructionMember("Widget", "Widget"), true, "c# type-named ctor");
  assert.strictEqual(isConstructionMember("render0", "Widget"), false, "an ordinary method is not a constructor");
});

// ===========================================================================
// §2 TypeScript — HOVER_SIGNATURE_CAP=8 is the product's own constant and it
//        leaks into the surface: a >8-member type shows only 8. The block must
//        show MORE than 8 when allowed, bounded downstream by the 1200-char
//        budget, never uncapped.
//
// INTERPRETATION: the cap must not be the SURFACE bound BY DEFAULT — driven with
// default options, membersWithHoverSignatures signs more than 8 at a 16-member
// type. The number is not hardcoded: asserted `> 8` and `<= member count`. The
// char-budget bound is proven separately in §3 (renderWholeBlockInjection).
// ===========================================================================

test("§2: a 16-member TypeScript type signs MORE than 8 members by default (the count cap is not the surface bound)", async () => {
  const methods = Array.from({ length: 16 }, (_, i) => `member${i}`);
  const t = memberType("Big", [], methods);

  const out = await membersWithHoverSignatures(t.symbols, t.cursor, roleId, buildMember, t.hoverSignatureAt);
  const n = signed(out).length;
  assert.ok(n > 8, `a >8-member type must show more than 8 signed members when the budget allows; got ${n}`);
  assert.ok(n <= 16, `never invents past the real member count; signed ${n} of 16`);
});

test("§2: the lift is not uncapped — signed members never exceed the real member count (no invention)", async () => {
  const methods = Array.from({ length: 20 }, (_, i) => `m${i}`);
  const t = memberType("Bigger", [], methods);

  const out = await membersWithHoverSignatures(t.symbols, t.cursor, roleId, buildMember, t.hoverSignatureAt);
  assert.ok(signed(out).length <= 20, `signed count is bounded by the member count; got ${signed(out).length}`);
  assert.ok(signed(out).length > 8, `still shows more than the old product cap of 8`);
});

// ===========================================================================
// §3 C# — renderWholeBlockInjection.
// ===========================================================================

const DEF_SENTINEL = /<<DEF (\w+)>>/g;
const csDef = (name, body) => `<<DEF ${name}>> class ${name} { ${body} }`;

// A resolvable graph: each root has a def (via resolveStruct) and a set of
// pre-rendered member lines (via methodsOf). Fields are left [] (the C# whole-block
// carries no field body); the members ride as method lines, exactly the shape the
// wiring passes.
function csGraph(spec) {
  const map = new Map(Object.entries(spec).map(([name, m]) => [name, { def: csDef(name, `/*${name}*/`), fields: [], methods: m }]));
  return {
    resolveStruct: (t) => map.get(t),
    methodsOf: (t) => (map.get(t) ? map.get(t).methods : []),
  };
}

const nonEmptyLines = (block) => block.split("\n").filter((l) => l.trim() !== "");

// --- §3(a) the block never overruns the tokenBudget, header + every prefix ---

test("§3a: the rendered block's TOTAL length (header + every `// ` prefix) is within tokenBudget", () => {
  // Enough member content to force the walk to spend the budget; the header and the
  // per-line comment prefixes must be charged AGAINST the budget, not added free.
  const members = Array.from({ length: 40 }, (_, i) => `public double LocationFactor${i}(RegionData region)`);
  const g = csGraph({ CostModel: members });
  const tokenBudget = 300;

  const block = renderWholeBlockInjection(["CostModel"], g.resolveStruct, g.methodsOf, BOUNDS, tokenBudget, "//");
  assert.ok(block, "a resolvable root renders a block");
  assert.ok(
    block.length <= tokenBudget,
    `the block must fit tokenBudget=${tokenBudget}; it is ${block.length} chars ` +
      `(the header and the ${nonEmptyLines(block).length} comment prefixes were charged AFTER the budget was spent)`,
  );
});

test("§3a: no member count produces a block longer than the budget (parameterized)", () => {
  for (const [count, budget] of [[16, 200], [40, 300], [80, 500], [160, 800]]) {
    const members = Array.from({ length: count }, (_, i) => `public double Factor${i}(RegionData r, LodBand b) => 0.0;`);
    const g = csGraph({ Model: members });
    const block = renderWholeBlockInjection(["Model"], g.resolveStruct, g.methodsOf, BOUNDS, budget, "//");
    if (block === undefined) continue; // honest degrade is within contract
    assert.ok(
      block.length <= budget,
      `[members=${count}, budget=${budget}] block overruns: ${block.length} > ${budget}`,
    );
  }
});

// --- §3(b) a member line in a multi-type block is attributable to its type ---

test("§3b: with two types each carrying a member named LocationFactor, each occurrence is attributable to a DIFFERENT owning type", () => {
  const g = csGraph({
    RegionAlpha: ["public int AlphaOnly()", "public double LocationFactor()"],
    RegionBeta: ["public int BetaOnly()", "public double LocationFactor()"],
  });
  // A budget large enough that nothing truncates — the concern here is attribution,
  // not overrun.
  const block = renderWholeBlockInjection(["RegionAlpha", "RegionBeta"], g.resolveStruct, g.methodsOf, BOUNDS, 4000, "//");
  assert.ok(block, "both types resolve into a block");

  // Both type defs render (their names anchor the sections).
  const defs = [...block.matchAll(DEF_SENTINEL)].map((m) => m[1]);
  assert.ok(defs.includes("RegionAlpha") && defs.includes("RegionBeta"), `both defs render; got ${JSON.stringify(defs)}`);

  const occurrences = [...block.matchAll(/LocationFactor/g)].map((m) => m.index);
  assert.strictEqual(occurrences.length, 2, `LocationFactor appears once per owning type; got ${occurrences.length}`);

  // The owner of an occurrence is the type whose NAME most recently precedes it
  // (works for a per-type grouped section AND for a same-line type qualifier; fails
  // only for a flat, anonymous "all defs then all members" layout — which is the
  // reader-can't-attribute defect the contract forbids).
  const ownerOf = (idx) => {
    const a = block.lastIndexOf("RegionAlpha", idx);
    const b = block.lastIndexOf("RegionBeta", idx);
    return a === b ? undefined : a > b ? "RegionAlpha" : "RegionBeta";
  };
  const owners = occurrences.map(ownerOf);
  assert.ok(
    owners[0] !== undefined && owners[1] !== undefined && owners[0] !== owners[1],
    `each LocationFactor must attribute to a distinct owning type; both attributed to ${JSON.stringify(owners)} ` +
      `(two anonymous identical lines under a "use these real names" header)`,
  );
});

// --- §3(c) the function being written is not listed as a type in play ---

// The leak (found by black-box probe, not by reading the detector): the
// doc-comment backtick miner — the same convention that surfaces a doc-named
// collaborator (blind-goalmd-fim-docname) — scrapes the ENCLOSING METHOD's own
// name when the doc mentions it in backticks. The near-universal doc convention
// "`Compute` returns a `LocationFactor`" names the function being written; the
// miner lists `Compute` as a collaborator type-in-play alongside the real ones.
// RegionData (param) and LocationFactor (doc collaborator) are legitimate; Compute
// — the function being written — is not.
const CS_DOC_SELF_PREFIX =
  "    /// <summary>`Compute` returns a `LocationFactor` for the region.</summary>\n" +
  "    public LocationFactor Compute(RegionData region)\n" +
  "    {\n" +
  "        ";

test("§3c: the real collaborators (param + doc-named) stay types in play (regression net)", () => {
  const site = csWholeBlockSite(CS_DOC_SELF_PREFIX);
  assert.ok(site, "an empty body over a doc naming collaborators is a whole-block site");
  assert.ok(site.types.includes("RegionData"), `the param collaborator RegionData is in play; got ${JSON.stringify(site.types)}`);
  assert.ok(site.types.includes("LocationFactor"), `the doc-named collaborator LocationFactor is in play; got ${JSON.stringify(site.types)}`);
});

test("§3c: the function being written (Compute) is NOT listed as a type in play, even when the doc mentions it in backticks", () => {
  const site = csWholeBlockSite(CS_DOC_SELF_PREFIX);
  assert.ok(site, "the site resolves");
  assert.ok(
    !site.types.includes("Compute"),
    `the enclosing function being written must not be scraped as a collaborator type; got ${JSON.stringify(site.types)}`,
  );
});

// ===========================================================================
// §4 Regression nets — surface-p3b §4 (what phase 3b does not touch) and §3's
//     "the other languages' blocks must not regress".
// ===========================================================================

test("§4: a small type well under budget renders unchanged — a comment block carrying its members, within budget", () => {
  const g = csGraph({ Small: ["public int Count()", "public string Name()"] });
  const budget = 1200;
  const block = renderWholeBlockInjection(["Small"], g.resolveStruct, g.methodsOf, BOUNDS, budget, "//");
  assert.ok(block, "the small type renders");
  assert.ok(block.length <= budget, `well under budget; ${block.length} <= ${budget}`);
  for (const line of nonEmptyLines(block)) {
    assert.ok(line.startsWith("//"), `every non-empty line is a comment; offending: ${JSON.stringify(line)}`);
  }
  assert.match(block, /Count/, "its member Count survives");
  assert.match(block, /Name/, "its member Name survives");
});

test("§4: another language (python `#`) is not regressed — its small block stays within budget and keeps its members", () => {
  const map = new Map([["Widget", { def: "# class Widget", fields: [], methods: ["render(self) -> int", "resize(self, n: int) -> None"] }]]);
  const resolveStruct = (t) => map.get(t);
  const methodsOf = (t) => (map.get(t) ? map.get(t).methods : []);
  const budget = 1200;
  const block = renderWholeBlockInjection(["Widget"], resolveStruct, methodsOf, BOUNDS, budget, "#");
  assert.ok(block, "the python block renders");
  assert.ok(block.length <= budget, `charging the header cannot evict a block already well under budget; ${block.length} <= ${budget}`);
  assert.match(block, /render/, "its method render survives");
});

test("§4: createInjectionCache is untouched — exact (uri, version) hit, newer version invalidates", () => {
  const cache = createInjectionCache();
  cache.set("file:///a.cs", 1, "BLOCK_V1");
  assert.strictEqual(cache.get("file:///a.cs", 1), "BLOCK_V1", "exact hit");
  assert.strictEqual(cache.get("file:///a.cs", 2), undefined, "a newer version is a miss");
  cache.set("file:///a.cs", 2, "BLOCK_V2");
  assert.strictEqual(cache.get("file:///a.cs", 1), undefined, "the old version was invalidated");
});

test("§4: wholeBlockSiteFor still resolves the csharp/python/typescript detectors (no sibling disturbed)", () => {
  for (const lang of ["csharp", "python", "typescript"]) {
    assert.strictEqual(typeof wholeBlockSiteFor(lang), "function", `wholeBlockSiteFor(${JSON.stringify(lang)}) resolves a detector`);
  }
});
