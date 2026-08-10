// Impl oracle for the Go extraction helpers (v23): the mechanism the blind
// contract set cannot see from the SurfaceExtractor surface alone —
//   * renderGoSignature's splice rules (func( / func ( / generic func[ /
//     field detail), reached through goMemberFromCompletionItem
//   * parseGoReceiverSymbol across receiver spellings (pointer, value,
//     generic, whitespace) and its refusals
//   * goMembersFromDocumentSymbols joins ONLY the queried receiver's
//     methods, keeps interface children, and answers [] outside containers
//   * parseGoHover section splitting (multi-`---`, link-only tail, no fence)
//
// The blind file (blind-v23-goextractor*.test.cjs) owns the contract; this
// file owns the mechanism. Transport behavior is proven by the blind LIVE
// rung against real gopls.
//
// Run: SKIP_LIVE=1 node --test test/impl-v23-goextractor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v23-goextractor",
  `export * from "../src/core/goExtraction";\n`,
);
test.after(() => cleanup());
const { goMemberFromCompletionItem, parseGoReceiverSymbol, goMembersFromDocumentSymbols, parseGoHover } = mod;

// ---------------------------------------------------------------------------
// renderGoSignature via the filter (the only public path to it)

const signatureCases = [
  ["Enroll", "func(byLod map[uint8][]Tile) (uint32, error)", 2, "Enroll(byLod map[uint8][]Tile) (uint32, error)", "method detail splices name over func"],
  ["NewStripe", "func() *Stripe", 3, "NewStripe() *Stripe", "function detail splices the same way"],
  ["Fanout", "uint32", 5, "Fanout uint32", "field detail renders Go-style `Name Type`"],
  ["Pick", "func[T any](xs []T) T", 3, "Pick[T any](xs []T) T", "generic func detail keeps the type params"],
  ["Resize", "func (w, h int)", 2, "Resize(w, h int)", "space after func is tolerated"],
  ["Multi", "func(a int,\n\tb int) error", 2, "Multi(a int, b int) error", "multi-line detail collapses to one line"],
];
for (const [label, detail, kind, want, why] of signatureCases) {
  test(`signature: ${why}`, () => {
    const m = goMemberFromCompletionItem({ label, kind, detail });
    assert.ok(m, "survives the filter");
    assert.strictEqual(m.signature, want);
  });
}

test("signature: absent/empty detail yields an undefined signature, never a bare-name fake", () => {
  assert.strictEqual(goMemberFromCompletionItem({ label: "X", kind: 5 }).signature, undefined);
  assert.strictEqual(goMemberFromCompletionItem({ label: "X", kind: 5, detail: "" }).signature, undefined);
});

// ---------------------------------------------------------------------------
// parseGoReceiverSymbol

const receiverCases = [
  ["(*Stripe).Enroll", "Stripe", "Enroll"],
  ["(Tile).SubtendedChildren", "Tile", "SubtendedChildren"],
  ["(*Cache[K, V]).Get", "Cache", "Get"],
  ["( *Widget ).Resize", "Widget", "Resize"],
  ["(數據).Read", "數據", "Read"],
];
for (const [name, receiver, member] of receiverCases) {
  test(`receiver parse: ${JSON.stringify(name)} -> ${receiver}.${member}`, () => {
    assert.deepStrictEqual(parseGoReceiverSymbol(name), { receiver, member });
  });
}

const receiverRefusals = ["NewStripe", "Stripe", "Stripe.Enroll", "(*).X", "()", "(*Stripe)", ""];
for (const name of receiverRefusals) {
  test(`receiver parse refuses ${JSON.stringify(name)}`, () => {
    assert.strictEqual(parseGoReceiverSymbol(name), undefined);
  });
}

// ---------------------------------------------------------------------------
// goMembersFromDocumentSymbols

const STRUCT = 23;
const INTERFACE = 11;
const METHOD = 6;
const FIELD = 8;
const range = (l0, l1) => ({ start: { line: l0, character: 0 }, end: { line: l1, character: 1 } });
const sym = (name, kind, r, extra = {}) => ({ name, kind, range: r, selectionRange: r, ...extra });

const fixture = [
  sym("Gauge", STRUCT, range(2, 5), {
    children: [sym("ticks", FIELD, range(3, 3), { detail: "uint32" })],
  }),
  sym("(*Gauge).Wind", METHOD, range(7, 9), { detail: "func(n uint32) error" }),
  sym("(Gauge).Read", METHOD, range(11, 13), { detail: "func() uint32" }),
  sym("(*Other).Wind", METHOD, range(15, 17), { detail: "func(n uint32) error" }),
  sym("NewGauge", 12, range(19, 21), { detail: "func() *Gauge" }),
  sym("Ticker", INTERFACE, range(23, 25), {
    children: [sym("Tick", METHOD, range(24, 24), { detail: "func() uint64" })],
  }),
];

test("join: struct members = own fields + BOTH receiver spellings' methods, NOT another type's, NOT free functions", () => {
  const members = goMembersFromDocumentSymbols(fixture, { uri: "u", line: 3, character: 0 });
  assert.deepStrictEqual(
    members.map((m) => m.name).sort(),
    ["Read", "Wind", "ticks"],
    "exactly Gauge's surface",
  );
  const wind = members.find((m) => m.name === "Wind");
  assert.strictEqual(wind.kind, "method");
  assert.strictEqual(wind.signature, "Wind(n uint32) error");
  const ticks = members.find((m) => m.name === "ticks");
  assert.strictEqual(ticks.kind, "field");
  assert.strictEqual(ticks.signature, "ticks uint32");
});

test("join: an interface's method set is its children", () => {
  const members = goMembersFromDocumentSymbols(fixture, { uri: "u", line: 24, character: 0 });
  assert.deepStrictEqual(members.map((m) => m.name), ["Tick"]);
  assert.strictEqual(members[0].kind, "method");
});

test("join: a cursor inside a method body or free function answers [], never a guessed container", () => {
  assert.deepStrictEqual(goMembersFromDocumentSymbols(fixture, { uri: "u", line: 8, character: 0 }), []);
  assert.deepStrictEqual(goMembersFromDocumentSymbols(fixture, { uri: "u", line: 20, character: 0 }), []);
});

test("join: non-array and garbage symbol shapes answer [], never throw", () => {
  assert.deepStrictEqual(goMembersFromDocumentSymbols(null, { uri: "u", line: 0, character: 0 }), []);
  assert.deepStrictEqual(goMembersFromDocumentSymbols({ items: [] }, { uri: "u", line: 0, character: 0 }), []);
  assert.deepStrictEqual(
    goMembersFromDocumentSymbols([null, { kind: STRUCT }, sym(42, STRUCT, range(0, 1))], { uri: "u", line: 0, character: 0 }),
    [],
  );
});

// ---------------------------------------------------------------------------
// parseGoHover sections

test("hover: multiple prose sections join as doc; the pkg.go.dev section never does", () => {
  const md = "```go\nfunc (s *Stripe) Enroll(code uint64) error\n```\n\n---\n\nEnroll adds one tile.\n\n---\n\nSecond paragraph.\n\n---\n\n[`atlas.Enroll` on pkg.go.dev](https://pkg.go.dev/x)";
  const h = parseGoHover(md);
  assert.strictEqual(h.signature, "func (s *Stripe) Enroll(code uint64) error");
  assert.match(h.doc, /one tile/);
  assert.match(h.doc, /Second paragraph/);
  assert.doesNotMatch(h.doc, /pkg\.go\.dev/);
});

test("hover: a link-only tail yields signature with NO doc key content; no fence yields undefined", () => {
  const linkOnly = parseGoHover("```go\ntype Tile struct{}\n```\n\n---\n\n[on pkg.go.dev](https://pkg.go.dev/x)");
  assert.strictEqual(linkOnly.signature, "type Tile struct{}");
  assert.strictEqual(linkOnly.doc, undefined);
  assert.strictEqual(parseGoHover("just prose, no fence"), undefined);
  assert.strictEqual(parseGoHover("```go\n\n```"), undefined, "an empty fence is not a signature");
});
