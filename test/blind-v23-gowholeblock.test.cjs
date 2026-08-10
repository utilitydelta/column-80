// BLIND ORACLE — session-v23 phase 3: the Go whole-block site detector
// (`goWholeBlockSite`), its types-in-play scan (`goTypesInPlay`), the
// `wholeBlockSiteFor("go")` registry row (dispatch-map row 3), and the v22
// arm-C render fit driven with Go shapes. Black-box: written from
// session-v23/goal.md + dispatch-map.md and the exported surface of
// src/core/fimWholeBlock.ts AS SHIPPED TODAY (the Rust/TS/C#/Python siblings
// and renderWholeBlockInjection); the Go implementation is never opened.
//
// Contract points:
//   goWholeBlockSite  fires ({signature, types}) when the cursor sits in an
//                     EMPTY (whitespace-only) body directly opened by a Go
//                     function-shaped header: `func name(params) Ret {`,
//                     multi-value returns `(A, B)`, method receivers
//                     `func (s *Stripe) name(...) {`, generic clauses
//                     `func name[T any](...)`. Signature is the header text
//                     from `func`, whitespace-normalized to ONE line.
//                     Dark (undefined): non-empty bodies, control-flow headers
//                     (if/for/switch/select), type declarations (struct/
//                     interface), composite literals (`x := Foo{`,
//                     `return []Tile{`), headers naming NO user type, bare
//                     blocks. Tab indentation throughout (gofmt emits tabs).
//   goTypesInPlay     capitalized user-type names from receiver + params +
//                     returns, first-appearance order; single-letter generics
//                     and the generic-clause names excluded; lowercase
//                     builtins (error/int/string) never appear; std qualified
//                     types (time.Time, sync.Mutex) stopped by a
//                     GO_STD_TYPE_NAMES-shaped set (dispatch-map row 6).
//                     A qualified `pkg.Type` contributes exactly ONE entry
//                     whose LAST dotted segment is `Type` — asserted via the
//                     last segment so either "atlas.Stripe" or "Stripe"
//                     passes (the exact spelling is the implementer's).
//   wholeBlockSiteFor "go" -> goWholeBlockSite; the other languages'
//                     detectors untouched.
//   arm-C render fit  renderWholeBlockInjection (v22, already exported) fed a
//                     Go struct def + Go method signatures with lineComment
//                     "//": methods-first ordering, BRACE-SAFE def truncation
//                     under a tight budget (never a dangling open brace in
//                     the comment block), terminator line last.
//
// Never reads src/** contents. Expected RED today: goWholeBlockSite /
// goTypesInPlay do not exist, so the bundle fails; the guard keeps one loud
// surface failure and skips the rest until the impl lands.
//
// Run: SKIP_LIVE=1 node --test test/blind-v23-gowholeblock.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v23-gowholeblock",
    `export { goWholeBlockSite, goTypesInPlay, wholeBlockSiteFor, renderWholeBlockInjection } from "../src/core/fimWholeBlock";\n`
  ));
} catch (e) {
  bundleError = e;
}
if (!bundleError && typeof mod.goWholeBlockSite !== "function") {
  bundleError = new Error("the bundle built but exports no goWholeBlockSite from src/core/fimWholeBlock.ts");
}
if (!bundleError && typeof mod.goTypesInPlay !== "function") {
  bundleError = new Error("the bundle built but exports no goTypesInPlay from src/core/fimWholeBlock.ts");
}
test.after(() => cleanup());

const { goWholeBlockSite, goTypesInPlay, wholeBlockSiteFor, renderWholeBlockInjection } = mod;

test("bundle: the v23 Go whole-block surface builds (goWholeBlockSite + goTypesInPlay in src/core/fimWholeBlock.ts) [surface: dispatch-map row 3]", () => {
  if (bundleError) {
    assert.fail(`the surface is not implemented yet: ${bundleError.message}`);
  }
});

// Every other test skips (not fails) while the bundle is broken, so the red
// run stays one loud failure instead of a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// The types contract pins the LAST dotted segment only, so "atlas.Stripe" and
// "Stripe" both pass — the resolver downstream needs the type reachable, the
// exact spelling is the implementer's.
const lastSegs = (types) => types.map((t) => String(t).split(".").pop());

// ---------------------------------------------------------------------------
// 1. goWholeBlockSite — FIRES. Tab indentation everywhere: gofmt's output is
//    tab-indented and so is everything the extension emits.
// ---------------------------------------------------------------------------

const FIRE_CASES = [
  // [name, prefix, signature substrings, expected type last-segments]
  [
    "plain func header, tab body",
    "package atlas\n\nfunc Enroll(s *Stripe) error {\n\t",
    ["func", "Enroll", "Stripe"],
    ["Stripe"],
  ],
  [
    "multi-value return (A, B)",
    "package atlas\n\nfunc Split(s Stripe) (LodBand, error) {\n\t",
    ["func", "Split", "LodBand"],
    ["Stripe", "LodBand"],
  ],
  [
    "method receiver inside a tab-indented file",
    "package atlas\n\ntype Stripe struct {\n\ttiles []Tile\n}\n\nfunc (s *Stripe) Enroll(t Tile) error {\n\t",
    ["func", "(s *Stripe)", "Enroll", "Tile"],
    ["Stripe", "Tile"],
  ],
  [
    "generic clause header naming a user type",
    "package atlas\n\nfunc Reduce[T any](xs []T, acc Stripe) Stripe {\n\t",
    ["func", "Reduce", "Stripe"],
    ["Stripe"],
  ],
  [
    "multi-line param list normalizes to one line",
    "package atlas\n\nfunc Enroll(\n\ts *Stripe,\n\tt Tile,\n) error {\n\t",
    ["func", "Enroll", "Stripe", "Tile"],
    ["Stripe", "Tile"],
  ],
  [
    "empty body means WHITESPACE-only: cursor right after the brace + newline",
    "func Fill(b *LodBand) error {\n",
    ["func", "Fill", "LodBand"],
    ["LodBand"],
  ],
];

gtest("goWholeBlockSite: fires at an empty body under a Go func-shaped header; signature is the one-line header from `func` [surface: goal 'Whole-block detector handles func f() T {, method receivers, multi-value returns, tab indentation']", () => {
  for (const [name, prefix, sigParts, typeSegs] of FIRE_CASES) {
    const site = goWholeBlockSite(prefix);
    assert.ok(site, `[${name}] expected a site, got undefined for prefix ${JSON.stringify(prefix)}`);
    assert.strictEqual(typeof site.signature, "string", `[${name}] signature is a string`);
    assert.match(site.signature, /^func\b/, `[${name}] the signature starts at the header's own \`func\`, got ${JSON.stringify(site.signature)}`);
    assert.ok(!site.signature.includes("\n"), `[${name}] the signature is whitespace-normalized to ONE line, got ${JSON.stringify(site.signature)}`);
    assert.ok(!site.signature.includes("\t"), `[${name}] no tabs survive the whitespace normalization, got ${JSON.stringify(site.signature)}`);
    for (const part of sigParts) {
      assert.ok(site.signature.includes(part), `[${name}] signature carries ${JSON.stringify(part)}; got ${JSON.stringify(site.signature)}`);
    }
    assert.deepStrictEqual(
      lastSegs(site.types),
      typeSegs,
      `[${name}] types (by last dotted segment, first-appearance order); got ${JSON.stringify(site.types)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. goWholeBlockSite — DARK. Every case a real gofmt-shaped (tab) prefix.
// ---------------------------------------------------------------------------

const DARK_CASES = [
  ["non-empty body", "func Enroll(s *Stripe) error {\n\treturn nil\n\t"],
  ["control flow: if header", "func Check(s *Stripe) error {\n\tif s != nil {\n\t\t"],
  ["control flow: for range header", "func Walk(xs []Tile) {\n\tfor i := range xs {\n\t\t"],
  ["control flow: switch header", "func Kind(t Tile) int {\n\tswitch t.kind {\n\t"],
  ["control flow: select header", "func Pump(ch chan Tile) {\n\tselect {\n\t"],
  ["type declaration: struct body", "package atlas\n\ntype X struct {\n\t"],
  ["type declaration: interface body", "package atlas\n\ntype I interface {\n\t"],
  ["composite literal: assignment", "func Mk(s Stripe) Stripe {\n\tx := Foo{\n\t\t"],
  ["composite literal: return []Tile{", "func Fill(s *Stripe) []Tile {\n\treturn []Tile{\n\t\t"],
  ["func header naming NO user type (error/int are not user types)", "func f(a int) error {\n\t"],
  ["func header naming NO user type (string/bool)", "func g(s string) bool {\n\t"],
  ["bare block inside a func", "func f(t Tile) {\n\t{\n\t\t"],
  ["no enclosing block at all", "package main\n\nfunc f(t Tile) error "],
  ["empty prefix", ""],
];

gtest("goWholeBlockSite: dark at non-empty bodies, control-flow headers, type declarations, composite literals, no-user-type headers, bare blocks [surface: the dark list in the phase-3 pin]", () => {
  for (const [name, prefix] of DARK_CASES) {
    assert.strictEqual(
      goWholeBlockSite(prefix),
      undefined,
      `[${name}] prefix=${JSON.stringify(prefix)} -> expected undefined, got ${JSON.stringify(goWholeBlockSite(prefix))}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The registry row.
// ---------------------------------------------------------------------------

gtest("wholeBlockSiteFor('go') === goWholeBlockSite; the other languages' detectors are untouched [surface: dispatch-map row 3 'wholeBlockSiteFor gains a go row']", () => {
  assert.strictEqual(wholeBlockSiteFor("go"), goWholeBlockSite, "the registry dispatches Go to the Go detector");
  for (const lang of ["rust", "typescript", "csharp", "python"]) {
    const d = wholeBlockSiteFor(lang);
    assert.strictEqual(typeof d, "function", `${lang} still has its own detector`);
    assert.notStrictEqual(d, goWholeBlockSite, `the Go detector did not swallow ${lang}`);
  }
  assert.strictEqual(wholeBlockSiteFor("java"), undefined, "an unregistered language stays dark");
});

// ---------------------------------------------------------------------------
// 4. goTypesInPlay — exported, receiver+params+returns, first appearance.
// ---------------------------------------------------------------------------

const TYPES_CASES = [
  // [name, signature, expected last-segments in order]
  ["receiver, param, return — first-appearance order", "func (s *Stripe) f(t Tile) (LodBand, error)", ["Stripe", "Tile", "LodBand"]],
  ["multi-value return", "func Split(s Stripe) (LodBand, error)", ["Stripe", "LodBand"]],
  ["generic-clause names and single-letter params excluded", "func Reduce[T any](xs []T, acc Stripe) Stripe", ["Stripe"]],
  ["dedup: one entry per type", "func Pair(a Tile, b Tile) Tile", ["Tile"]],
  ["lowercase builtins never appear (not capitalized)", "func f(a int, b string, e error) bool", []],
  ["single-letter generics alone -> empty", "func Head[T any](xs []T) T", []],
];

gtest("goTypesInPlay: capitalized receiver/param/return type names, first-appearance order; generics and builtins excluded [surface: 'func (s *Stripe) f(t Tile) (LodBand, error) -> Stripe, Tile, LodBand']", () => {
  for (const [name, sig, expected] of TYPES_CASES) {
    assert.deepStrictEqual(
      lastSegs(goTypesInPlay(sig)),
      expected,
      `[${name}] sig=${JSON.stringify(sig)} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(goTypesInPlay(sig))}`,
    );
  }
});

gtest("goTypesInPlay: a qualified `pkg.Type` contributes exactly ONE entry whose last dotted segment is the type [surface: 'atlas.Stripe contributes one entry; the entry's LAST segment is Stripe — either spelling passes']", () => {
  const types = goTypesInPlay("func Load(s atlas.Stripe) error");
  assert.strictEqual(types.length, 1, `exactly one entry for one qualified type; got ${JSON.stringify(types)}`);
  assert.match(String(types[0]), /(^|\.)Stripe$/, `the entry ends in the type's own name; got ${JSON.stringify(types[0])}`);
});

gtest("goTypesInPlay: std qualified types are stopped — time.Time and sync.Mutex never appear (GO_STD_TYPE_NAMES-shaped stop set) [surface: dispatch-map row 6 by decision]", () => {
  const types = goTypesInPlay("func Wait(t time.Time, mu sync.Mutex, s Stripe) error");
  assert.deepStrictEqual(lastSegs(types), ["Stripe"], `only the user type survives; got ${JSON.stringify(types)}`);
  for (const t of types) {
    assert.ok(!/(^|\.)Time$/.test(t) && !/(^|\.)Mutex$/.test(t), `no std entry rides through; got ${JSON.stringify(types)}`);
  }
});

// ---------------------------------------------------------------------------
// 5. Arm-C render fit with Go shapes (renderWholeBlockInjection is the v22
//    export; the call shape mirrors blind-v22-rebudget.test.cjs). The def is a
//    tab-indented Go struct, the methods are Go method signatures, "//" is
//    the Go line comment (dispatch-map row 5).
// ---------------------------------------------------------------------------

const BOUNDS = { D_MAX: 4, B_MAX: 8, N_MAX: 64, TOK_MAX: 100000 };
const BIG_BUDGET = 100000;
const TERMINATOR = "end of type info - the body follows:";

const goStructDef = (name, k) => {
  const fields = Array.from({ length: k }, (_, i) => `\tfield${i} map[uint8][]Tile`);
  return `type ${name} struct {\n${fields.join("\n")}\n}`;
};

const goGraph = (spec) => {
  const map = new Map(Object.entries(spec));
  return {
    resolveStruct: (t) => (map.has(t) ? { def: map.get(t).def, fields: [] } : undefined),
    methodsOf: (t) => (map.has(t) ? map.get(t).methods || [] : []),
  };
};

const render = (roots, g, budget) =>
  renderWholeBlockInjection(roots, g.resolveStruct, g.methodsOf, BOUNDS, budget, "//");

const nonEmptyLines = (block) => block.split("\n").filter((l) => l.trim() !== "");
const countChar = (s, ch) => s.split(ch).length - 1;

gtest("arm-C fit: a Go struct def + Go method signatures render methods-first, every line a // comment, terminator last [surface: v22 arm C survives Go shapes]", () => {
  const g = goGraph({
    Stripe: {
      def: goStructDef("Stripe", 3),
      methods: ["func (s *Stripe) Enroll(t Tile) error", "func (s *Stripe) Bands() []LodBand"],
    },
  });
  const block = render(["Stripe"], g, BIG_BUDGET);
  assert.ok(block, "the Go root resolves into a block");
  for (const line of nonEmptyLines(block)) {
    assert.ok(line.startsWith("//"), `every non-empty line is a // comment; offending: ${JSON.stringify(line)}`);
  }
  const lastMethodIdx = Math.max(block.indexOf("Enroll(t Tile)"), block.indexOf("Bands() []LodBand"));
  const defIdx = block.indexOf("type Stripe struct");
  assert.ok(lastMethodIdx !== -1 && defIdx !== -1, "methods and the def both ride the block");
  assert.ok(lastMethodIdx < defIdx, `methods-first ordering survives Go shapes; last method @${lastMethodIdx}, def @${defIdx}`);
  const lines = nonEmptyLines(block);
  const last = lines[lines.length - 1];
  assert.ok(last.startsWith("//") && last.includes(TERMINATOR), `the terminator is the last comment line; got ${JSON.stringify(last)}`);
  assert.strictEqual(last.replace("//", "").trim(), TERMINATOR, "the terminator text is exact");
});

gtest("arm-C fit: a tab-indented Go struct def truncates BRACE-SAFE under a tight budget — marker, balanced braces, no dangling open brace, terminator still last [surface: v22 INV-truncation over Go's brace-delimited defs]", () => {
  const K = 40;
  const g = goGraph({
    Stripe: {
      def: goStructDef("Stripe", K),
      methods: ["func (s *Stripe) Enroll(t Tile) error"],
    },
  });
  const whole = render(["Stripe"], g, BIG_BUDGET);
  assert.ok(whole, "the def renders whole at a non-binding budget");
  const budget = Math.floor(whole.length * 0.6);

  const block = render(["Stripe"], g, budget);
  assert.ok(block, `a partial Go def must still render (budget=${budget}); undefined is the pre-v22 atomic-drop`);
  assert.ok(block.length <= budget, `the truncated block stays within budget; ${block.length} <= ${budget}`);

  const m = block.match(/\.\.\. (\d+) more fields/);
  assert.ok(m, `the brace-safe truncation marker appears; block was:\n${block}`);
  const shown = [...block.matchAll(/field\d+ map\[uint8\]\[\]Tile/g)].length;
  assert.ok(shown >= 1 && shown < K, `1..K-1 field lines shown; shown=${shown} of ${K}`);
  assert.strictEqual(Number(m[1]), K - shown, `marker N equals fields dropped; said ${m[1]}, dropped ${K - shown}`);

  assert.strictEqual(
    countChar(block, "{"),
    countChar(block, "}"),
    `never a dangling open brace inside the emitted comment block; { = ${countChar(block, "{")}, } = ${countChar(block, "}")}`,
  );
  assert.ok(block.lastIndexOf("}") > m.index, "the closing brace follows the truncation marker");

  const lines = nonEmptyLines(block);
  const last = lines[lines.length - 1];
  assert.ok(last.includes(TERMINATOR), `the terminator still ends the truncated block; got ${JSON.stringify(last)}`);
});
