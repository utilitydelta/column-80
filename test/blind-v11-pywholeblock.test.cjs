// BLIND ORACLE — v11 (Python) Phase 4, NEW BUILD 1: the indentation-based
// `pyWholeBlockSite(prefix)` detector + the `wholeBlockSiteFor("python")`
// registry arm (src/core/fimWholeBlock.ts). Written from phase4-brief.md
// section (c) NEW BUILD 1 + the WholeBlockSite `{signature, types}` contract
// ONLY. The implementation is written AFTER this file and is never opened.
//
// TODO-vs-HARD ruling (the brief authorizes deferring this build):
//   These tests are HARD assertions, NOT `{ todo: true }`. The contract is
//   NOT under-specified — section (c) hands a concrete algorithm (split
//   physical lines; scan back for the depth-0 header-terminating `:` over a
//   whitespace-only body; walk the paren-continuation logical line; require it
//   to start with `def `/`async def `; extract PascalCase param annotations +
//   `-> Return` minus PY_STD_TYPE_NAMES/TypeVars). A specified contract earns
//   hard assertions.
//   HONEST CAVEAT for the implementer: the brief (OQ-6 / scrap P4-2) EXPLICITLY
//   authorizes DEFERRING pyWholeBlockSite if the indentation parser is not
//   provably solid — whole-block is a FIM enhancement, not the goal's mandatory
//   surface. If the build is deferred, `pyWholeBlockSite`/the python arm stay
//   absent and THIS ENTIRE FILE STAYS RED BY DESIGN. That red is the visible
//   signal that whole-block was scoped out — it is NOT a regression, and the
//   go-live flip is not blocked by it. The rust/ts/csharp registry guards below
//   MUST stay green regardless (they pin that no sibling detector was disturbed).
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-pywholeblock.test.cjs
// Expected: RED until pyWholeBlockSite lands (or permanently red if deferred).

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleErr;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v11-pywholeblock",
    `export { pyWholeBlockSite, wholeBlockSiteFor } from "../src/core/fimWholeBlock";\n`,
  ));
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());

const { pyWholeBlockSite, wholeBlockSiteFor } = mod;

test("bundle guard: fimWholeBlock bundles headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
});

// ===========================================================================
// 1. wholeBlockSiteFor registry — python resolves a detector; the three
//    brace-based siblings (rust/ts/csharp) are UNDISTURBED (still resolve).
//    This guard stays GREEN even if pyWholeBlockSite is deferred? No: the
//    python arm is part of the same build. But the rust/ts/csharp arms MUST
//    stay resolvable regardless — asserted separately so their green survives.
// ===========================================================================

test("wholeBlockSiteFor: rust/ts/csharp arms are undisturbed (still resolve to a detector fn)", () => {
  assert.strictEqual(typeof wholeBlockSiteFor, "function", "wholeBlockSiteFor is exported");
  for (const lang of ["rust", "typescript", "typescriptreact", "csharp"]) {
    const det = wholeBlockSiteFor(lang);
    assert.strictEqual(
      typeof det,
      "function",
      `wholeBlockSiteFor(${JSON.stringify(lang)}) must still resolve a detector fn (sibling undisturbed); got ${typeof det}`,
    );
  }
});

test("wholeBlockSiteFor('python'): resolves the pyWholeBlockSite detector", () => {
  const det = wholeBlockSiteFor("python");
  assert.strictEqual(typeof det, "function", `wholeBlockSiteFor('python') must resolve a detector fn; got ${typeof det}`);
});

// ===========================================================================
// 2. pyWholeBlockSite — the site shape. Cursor in an EMPTY def body over a
//    signature naming a user type. Returns { signature, types }.
// ===========================================================================

// A single-line header, cursor on the first (empty) body line.
const SINGLE_LINE =
  "from model import Widget, Order\n\ndef foo(a: Widget) -> Order:\n    ";

test("pyWholeBlockSite: single-line header, empty body -> site with signature + types", () => {
  const site = pyWholeBlockSite(SINGLE_LINE);
  assert.ok(site, "an empty-body def site resolves (not undefined)");
  assert.strictEqual(typeof site.signature, "string", "signature is a string");
  assert.match(site.signature, /def foo/, "signature is the enclosing def header");
  assert.match(site.signature, /:\s*$/, "signature carries the trailing header ':' (the whole header incl ':')");
  assert.ok(Array.isArray(site.types), "types is an array");
  assert.ok(site.types.includes("Widget"), `Widget (param annotation) is a type-in-play; got ${JSON.stringify(site.types)}`);
  assert.ok(site.types.includes("Order"), `Order (-> return) is a type-in-play; got ${JSON.stringify(site.types)}`);
});

// THE CRUX: a MULTI-LINE header (implicit paren continuation). The depth-0 `:`
// terminator sits on the last physical line; the `def` on the first. Step-3's
// logical-line reconstruction must still recover the whole header and detect it.
const MULTI_LINE =
  "def foo(\n" +
  "    a: Widget,\n" +
  "    b: Order,\n" +
  ") -> Result:\n" +
  "    ";

test("pyWholeBlockSite: MULTI-LINE header (paren-continuation) is still detected — THE CRUX", () => {
  const site = pyWholeBlockSite(MULTI_LINE);
  assert.ok(site, "a multi-line def header over an empty body is a whole-block site (the crux the brace detectors never faced)");
  assert.match(site.signature, /def foo/, "the reconstructed logical-line signature names the def");
  assert.match(site.signature, /Result/, "the reconstructed signature reaches the '-> Result' terminator on the last physical line");
  assert.ok(site.types.includes("Widget"), `Widget survives across the line break; got ${JSON.stringify(site.types)}`);
  assert.ok(site.types.includes("Order"), `Order survives across the line break; got ${JSON.stringify(site.types)}`);
  assert.ok(site.types.includes("Result"), `the return type Result is in play; got ${JSON.stringify(site.types)}`);
});

test("pyWholeBlockSite: async def is a site (async def is reserved, the safe keyword scan)", () => {
  const prefix = "async def fetch(a: Widget) -> Order:\n    ";
  const site = pyWholeBlockSite(prefix);
  assert.ok(site, "async def over an empty body is a whole-block site");
  assert.match(site.signature, /async def fetch/, "signature carries the async def header");
  assert.ok(site.types.includes("Widget") && site.types.includes("Order"), `types extracted from an async def; got ${JSON.stringify(site && site.types)}`);
});

test("pyWholeBlockSite: a NESTED def (inside an outer def body) is a site for the inner header", () => {
  const prefix =
    "def outer(w: Widget) -> None:\n" +
    "    x = 1\n" +
    "    def inner(o: Order) -> Result:\n" +
    "        ";
  const site = pyWholeBlockSite(prefix);
  assert.ok(site, "the innermost enclosing def (inner) is the whole-block site");
  assert.match(site.signature, /def inner/, "the site is the INNER def, nearest the cursor (not outer)");
  assert.ok(site.types.includes("Order") && site.types.includes("Result"), `inner's types in play; got ${JSON.stringify(site && site.types)}`);
  assert.ok(!site.types.includes("Widget"), `outer's Widget is NOT the inner signature's type; got ${JSON.stringify(site.types)}`);
});

// ===========================================================================
// 3. NOT a site (stay dark / conservative -> undefined).
// ===========================================================================

test("pyWholeBlockSite: a non-empty body (cursor after real code) is NOT a site", () => {
  const dark = "def foo(a: Widget) -> Order:\n    return a.";
  assert.strictEqual(
    pyWholeBlockSite(dark),
    undefined,
    "a body with real content after the header ':' is not a whole-block site (empty-body strictness)",
  );
});

// Every non-def compound header ends in `:` but is NOT a def -> must be dark.
const NON_DEF_HEADERS = [
  ["class", "class Foo(Base):\n    "],
  ["if", "if isinstance(a, Widget):\n    "],
  ["for", "for item in orders:\n    "],
  ["while", "while ok:\n    "],
  ["with", "with open(p) as f:\n    "],
];

test("pyWholeBlockSite: class/if/for/while/with headers are NOT def sites (dark)", () => {
  for (const [name, prefix] of NON_DEF_HEADERS) {
    assert.strictEqual(
      pyWholeBlockSite(prefix),
      undefined,
      `[${name}] a '${name}:' compound header ending in ':' over an empty body must NOT be a whole-block site; got ${JSON.stringify(pyWholeBlockSite(prefix))}`,
    );
  }
});

// A `:` that is NOT a header terminator: dict literal, lambda, slice. None of
// these is a def body, so none is a whole-block site.
const NON_HEADER_COLONS = [
  ["dict literal", 'd = {"a": Widget}\n', "a trailing dict literal, no def"],
  ["lambda", "f = lambda x: x + 1\n", "a lambda colon, no def"],
  ["slice", "s = arr[1:2]\n", "a slice colon, no def"],
];

test("pyWholeBlockSite: dict/lambda/slice colons are NOT header terminators (dark)", () => {
  for (const [name, prefix, why] of NON_HEADER_COLONS) {
    assert.strictEqual(
      pyWholeBlockSite(prefix + "    "),
      undefined,
      `[${name}] ${why}: must NOT be a whole-block site; got ${JSON.stringify(pyWholeBlockSite(prefix + "    "))}`,
    );
  }
});

test("pyWholeBlockSite: a def whose only types are stdlib/TypeVars returns undefined (no user type survives)", () => {
  // `int`/`str` are PY_STD_TYPE_NAMES; `T` is a bare single-letter TypeVar.
  const stdOnly = "def f(x: int, y: str, t: T) -> int:\n    ";
  assert.strictEqual(
    pyWholeBlockSite(stdOnly),
    undefined,
    `a signature whose annotations are all stdlib/TypeVars is not a whole-block site (nothing to inject); got ${JSON.stringify(pyWholeBlockSite(stdOnly))}`,
  );
});

// ===========================================================================
// 4. types extraction detail — dedup, exclude stdlib, `-> Return` captured,
//    it is the SIGNATURE's types (not a file-wide PascalCase scrape).
// ===========================================================================

test("pyWholeBlockSite: types are the signature's own (deduped, stdlib excluded, no file-wide scrape)", () => {
  // `Decoy` is PascalCase but named only in an UNRELATED prior line, never in
  // the enclosing signature — it must not leak into types-in-play.
  const prefix =
    "class Decoy: pass\n" +
    "def helper(d: Decoy) -> None: ...\n\n" +
    "def codes_within(a: Widget, b: Widget) -> Order:\n" +
    "    ";
  const site = pyWholeBlockSite(prefix);
  assert.ok(site, "the whole-block site resolves");
  assert.ok(site.types.includes("Widget"), `Widget is a type-in-play; got ${JSON.stringify(site.types)}`);
  assert.strictEqual(
    site.types.filter((t) => t === "Widget").length,
    1,
    `Widget appears twice in the signature but is deduped to one entry; got ${JSON.stringify(site.types)}`,
  );
  assert.ok(site.types.includes("Order"), `the '-> Order' return type is captured; got ${JSON.stringify(site.types)}`);
  assert.ok(
    !site.types.includes("Decoy"),
    `Decoy is named elsewhere in the file, never in the enclosing signature — must not leak; got ${JSON.stringify(site.types)}`,
  );
});
