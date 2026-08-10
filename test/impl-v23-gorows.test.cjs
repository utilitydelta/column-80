// Impl oracle for the Go dispatch rows (v23): mechanism edges the blind
// contract set does not reach —
//   * goTypesInPlay's func-name exclusion guard (the capitalized-name trap
//     is Go-only) and the anonymous-literal return-type edge behind it
//   * goGenericClauseNames depth handling (`[]byte` inside a constraint)
//   * goFileLocalDefinitions: methods excluded, block-comment and raw-string
//     neutralization
//   * goMemberSite: unicode-adjacent edges and the comment rule being
//     CURRENT-line scoped
//
// Run: SKIP_LIVE=1 node --test test/impl-v23-gorows.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v23-gorows",
  `export { goWholeBlockSite, goTypesInPlay } from "../src/core/fimWholeBlock";
   export { goMemberSite } from "../src/core/fimInject";
   export { goFileLocalDefinitions } from "../src/core/instructPostprocess";\n`,
);
test.after(() => cleanup());
const { goWholeBlockSite, goTypesInPlay, goMemberSite, goFileLocalDefinitions } = mod;

// ---------------------------------------------------------------------------
// goTypesInPlay mechanism

const typeCases = [
  ["func Enroll(s Stripe) error", ["Stripe"], "exported func name never reads as a type"],
  ["func (g *Gauge) Wind(t Tile) Gauge", ["Gauge", "Tile"], "receiver scanned, name skipped, first-appearance order"],
  ["func(x Tile) LodBand", ["Tile", "LodBand"], "anonymous literal: the return type survives the name guard"],
  ["func Reduce[T Node](xs []T, s Stripe) T", ["Stripe"], "constraint names are clause names, excluded with T"],
  ["func Map[K comparable, V any](m map[K]V, b []byte) Stripe", ["Stripe"], "a []byte inside the clause does not close it early"],
  ["func Wait(d time.Duration, mu *sync.RWMutex) error", [], "std stop-set catches Duration and RWMutex"],
];
for (const [sig, want, why] of typeCases) {
  test(`goTypesInPlay: ${why}`, () => {
    assert.deepStrictEqual(goTypesInPlay(sig), want, sig);
  });
}

test("goWholeBlockSite: a function-typed param never truncates the header - the receiver survives [review F20]", () => {
  const site = goWholeBlockSite("func (s *Stripe) Each(fn func(t Tile) error) {\n\t");
  assert.ok(site, "fires");
  assert.match(site.signature, /^func \(s \*Stripe\) Each/, "the FULL header, not the callback's tail");
  assert.deepStrictEqual(site.types, ["Stripe", "Tile"]);
});

test("goWholeBlockSite: a `func` inside a doc comment above the header never wins the header scan [review F20 hardening]", () => {
  const site = goWholeBlockSite("// use func literals sparingly\nfunc Wind(g Gauge) error {\n\t");
  assert.ok(site);
  assert.match(site.signature, /^func Wind/);
  assert.deepStrictEqual(site.types, ["Gauge"]);
});

test("goTypesInPlay: a generic METHOD's receiver type-params are clause names, never roots - the receiver TYPE itself stays [review F23]", () => {
  assert.deepStrictEqual(goTypesInPlay("func (c *Cache[Key, Val]) Get(k Key, s Stripe) Val"), ["Cache", "Stripe"]);
});

test("goFileLocalDefinitions: a backslash inside a raw string swallows nothing [review F22]", () => {
  const src = 'package x\n\nvar re = `\\d+`\n\nfunc After() {}\ntype Later struct{}\n';
  const defs = goFileLocalDefinitions(src);
  assert.ok(defs.has("After") && defs.has("Later"), "defs after the raw string survive");
});

test("goWholeBlockSite: a func literal assigned inside an enclosing body is rejected by the clean-header rule", () => {
  // cursor after the LITERAL's brace but the enclosing func's `{` sits
  // between the outer `func` and here only for the OUTER func; the literal's
  // own header is clean - it fires only if it names a user type.
  const dark = "func Outer() {\n\tf := func(a int) int {";
  assert.strictEqual(goWholeBlockSite(dark), undefined, "no user type -> dark");
  const lit = "func Outer() {\n\tf := func(t Tile) uint32 {";
  const site = goWholeBlockSite(lit);
  assert.ok(site && site.types.includes("Tile"), "a literal naming a user type is a site");
});

// ---------------------------------------------------------------------------
// goFileLocalDefinitions mechanism

test("goFileLocalDefinitions: methods are NOT top-level names; func/type are; comments and raw strings are neutral", () => {
  const src = [
    "package atlas",
    "",
    "func NewStripe() *Stripe { return nil }",
    "type Stripe struct{}",
    "func (s *Stripe) Enroll() {}",
    "// func GhostComment() {}",
    "/*",
    "func GhostBlock() {}",
    "*/",
    "var raw = `",
    "func GhostRaw() {}",
    "`",
  ].join("\n");
  const defs = goFileLocalDefinitions(src);
  assert.ok(defs.has("NewStripe") && defs.has("Stripe"), "func + type collected");
  assert.ok(!defs.has("Enroll"), "method name is reached via its receiver, never re-imported");
  for (const ghost of ["GhostComment", "GhostBlock", "GhostRaw"]) {
    assert.ok(!defs.has(ghost), `${ghost} neutralized`);
  }
});

// ---------------------------------------------------------------------------
// goMemberSite edges

test("goMemberSite: the // rule is CURRENT-line scoped - a comment on the line above darkens nothing", () => {
  assert.deepStrictEqual(goMemberSite("\t// warm the stripe\n\ts."), { partial: "" });
  assert.strictEqual(goMemberSite("\t// s."), undefined);
});

test("goMemberSite: a URL in a string is still a dot site mechanically; the string context is not this detector's job", () => {
  // pinned so a future 'fix' that regexes strings out documents itself here
  assert.deepStrictEqual(goMemberSite('x := "https://pkg.'), { partial: "" });
});
