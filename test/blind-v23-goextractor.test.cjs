// BLIND ORACLE — v23 Go PURE helpers (src/core/goExtraction.ts). Black-box,
// from the session-v23 goal member-gate/extractor sections + scout-findings +
// the SurfaceExtractor interface ONLY. No gopls here: every completion/
// documentSymbol/hover shape below is transcribed from the PROVEN facts the
// 2026-07-24 rescout pinned (gopls v0.23.0, headless stdio):
//   - Contamination at a `.` site is exactly two shapes: postfix snippets
//     (kind=Snippet, `!`-suffixed labels — a slice receiver gets 12 and zero
//     real members) and deep completions (dotted/called labels like
//     `band.Ceiling`, `NewStripe().Enroll`). The TWO-RULE filter drops both;
//     what remains is the complete member set.
//   - gopls documentSymbol names methods top-level as `(*Stripe).Enroll`
//     (pointer receiver) / `(Tile).SubtendedChildren` (value receiver), full
//     signature in `detail`.
//   - Hover markdown is a ```go fence (the signature), then `---`-separated
//     doc prose, then possibly a `---`-separated pkg.go.dev link section —
//     the link section is NOT doc prose.
//   - The one legal non-identifier continuation at a dot is a type assertion
//     `x.(T)`; it starts with `(`, so a name-set gate must never see it.
//
// Never read src/**. Expected RED: src/core/goExtraction.ts does not exist
// yet. The guard keeps the red to one loud failure; the rest skip.
//
// Run: SKIP_LIVE=1 node --test test/blind-v23-goextractor.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v23-goextraction",
    `export * as g from "../src/core/goExtraction";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v23-goextraction.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v23-goextraction.bundle.cjs"), { force: true });
  };
}
const g = (mod && mod.g) || {};

test.after(() => cleanup());

test("bundle: the v23 Go pure-helper surface builds (src/core/goExtraction.ts exists, headless-bundleable) [surface: goal 'GoSurfaceExtractor' + the vNN blind convention]", () => {
  if (bundleError) assert.fail(`the Go pure helpers are not implemented yet: ${bundleError.message}`);
  for (const fn of ["isPlainGoIdentifier", "goMemberFromCompletionItem", "parseGoReceiverSymbol", "parseGoHover"]) {
    assert.strictEqual(typeof g[fn], "function", `goExtraction exports ${fn}`);
  }
});

const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// LSP CompletionItemKind (1-indexed): Method=2 Function=3 Field=5 Variable=6
// Text=1 Keyword=14 Snippet=15. The headless transport speaks raw LSP numbers.
const LK = { Text: 1, Method: 2, Function: 3, Field: 5, Variable: 6, Keyword: 14, Snippet: 15 };

// ===========================================================================
// isPlainGoIdentifier — rule 2 of the two-rule filter
// ===========================================================================

gtest("isPlainGoIdentifier: true for every bare Go identifier — unicode letters/digits/underscore, not starting with a digit [surface: goal member-gate rule 2]", () => {
  for (const id of [
    "Enroll", "AggregateFanout", "RehomeByLod", "x", "x1", "_", "_private",
    "tiles", "band", "Read", "π", "añejo", "数据",
  ]) {
    assert.strictEqual(g.isPlainGoIdentifier(id), true, `${JSON.stringify(id)} is a plain Go identifier`);
  }
});

gtest("isPlainGoIdentifier: false for dotted, called, bang-suffixed, parenthesized, empty, whitespace-carrying, digit-leading labels [surface: scout 'deep completions arrive with dotted or called labels' + postfix '!' labels]", () => {
  for (const label of [
    "band.Ceiling", "Domain().String", "NewStripe().Enroll", // deep completions
    "var!", "print!", "append!", // postfix snippet labels
    "(T)", "(atlas.Tile)", "x.(T)", // parenthesized / type-assertion shapes
    "", " ", "foo bar", " Enroll", "Enroll ", "foo()", "1x", "9",
  ]) {
    assert.strictEqual(g.isPlainGoIdentifier(label), false, `${JSON.stringify(label)} is NOT a plain Go identifier`);
  }
});

gtest("isPlainGoIdentifier: the type assertion `x.(T)` — the one legal non-identifier continuation at a dot — never reads as an identifier: '(T)' is false [surface: goal pin 'a type assertion x.(T) passes ungated' — the name-set gate never sees it]", () => {
  assert.strictEqual(g.isPlainGoIdentifier("(T)"), false, "'(T)' starts with '(', not a name — the gate must never treat it as a member");
});

// ===========================================================================
// goMemberFromCompletionItem — THE TWO-RULE FILTER
// ===========================================================================

gtest("filter rule 1: kind=15 (LSP Snippet, the postfix var!/print!/append! items) -> undefined, even when the label happens to be a plain identifier [surface: scout 'postfix snippets arrive as kind=Snippet']", () => {
  for (const item of [
    { label: "var!", kind: LK.Snippet },
    { label: "print!", kind: LK.Snippet },
    { label: "append!", kind: LK.Snippet, detail: "append and reassign" },
    { label: "forr", kind: LK.Snippet }, // plain-identifier label, snippet kind: STILL dropped
  ]) {
    assert.strictEqual(g.goMemberFromCompletionItem(item), undefined, `snippet item ${JSON.stringify(item.label)} is dropped by kind alone`);
  }
});

gtest("filter rule 2: any label failing isPlainGoIdentifier -> undefined, regardless of kind [surface: scout 'deep completions arrive with dotted or called labels']", () => {
  for (const item of [
    { label: "band.Ceiling", kind: LK.Field },
    { label: "Domain().String", kind: LK.Method },
    { label: "NewStripe().Enroll", kind: LK.Method, detail: "func(code uint64)" },
    { label: "(T)", kind: LK.Method },
    { label: "", kind: LK.Method },
  ]) {
    assert.strictEqual(g.goMemberFromCompletionItem(item), undefined, `non-identifier label ${JSON.stringify(item.label)} is dropped`);
  }
});

gtest("kind mapping: LSP 2->method, 3->function, 5->field, others->'other', and NEVER 'text' from this path [surface: pinned kind table + extraction.ts 'text is not an API member']", () => {
  assert.strictEqual(g.goMemberFromCompletionItem({ label: "Enroll", kind: LK.Method }).kind, "method", "Method(2) -> method");
  assert.strictEqual(g.goMemberFromCompletionItem({ label: "TileFromMorton", kind: LK.Function }).kind, "function", "Function(3) -> function");
  assert.strictEqual(g.goMemberFromCompletionItem({ label: "Morton", kind: LK.Field }).kind, "field", "Field(5) -> field");
  for (const kind of [LK.Text, LK.Variable, LK.Keyword, 7, 9, 22, undefined]) {
    const m = g.goMemberFromCompletionItem({ label: "Lod", kind });
    assert.ok(m, `a plain-identifier non-snippet item survives (kind ${kind})`);
    assert.notStrictEqual(m.kind, "text", `kind ${kind} never maps to 'text' (that is the editor's word-fallback evidence, not a gopls item)`);
    if (kind !== LK.Method && kind !== LK.Function && kind !== LK.Field) {
      assert.strictEqual(m.kind, "other", `unmapped kind ${kind} -> 'other'`);
    }
  }
});

gtest("member build: name is the label; the detail signature rides the member — name spliced on, params+return kept, one line, no invention when detail is absent [surface: goal 'signatures ride the completion item' + extraction.ts 'never bare names']", () => {
  const m = g.goMemberFromCompletionItem({
    label: "RehomeByLod",
    kind: LK.Method,
    detail: "func(byLod map[uint8][]Tile) (uint32, error)",
  });
  assert.ok(m, "a real method item builds a member");
  assert.strictEqual(m.name, "RehomeByLod", "name is the label verbatim");
  assert.ok(typeof m.signature === "string" && m.signature.length > 0, "detail present -> signature present");
  assert.ok(/(^|[^A-Za-z0-9_])RehomeByLod(?![A-Za-z0-9_])/.test(m.signature), `the signature names the member (the injected payload is never a bare type), got ${JSON.stringify(m.signature)}`);
  assert.ok(m.signature.includes("map[uint8][]Tile"), "the parameter type survives");
  assert.ok(m.signature.includes("(uint32, error)"), "the multi-value return survives (the load-bearing signal)");
  assert.ok(!m.signature.includes("\n"), "one line, always");

  const bare = g.goMemberFromCompletionItem({ label: "Enroll", kind: LK.Method });
  assert.ok(bare, "detail-less item still builds");
  assert.strictEqual(bare.signature, undefined, "no detail -> no signature (never invented)");

  const field = g.goMemberFromCompletionItem({ label: "Floor", kind: LK.Field, detail: "uint8" });
  assert.ok(field && typeof field.signature === "string" && field.signature.includes("uint8"), `a field's detail type rides its signature, got ${JSON.stringify(field && field.signature)}`);
});

gtest("two-rule filter completeness, transcribed member site: a *Stripe bare-dot list (6 real methods + 3 deep completions + 3 snippets) filters to EXACTLY the six [surface: goal 'what remains is the complete member set']", () => {
  const items = [
    { label: "Enroll", kind: LK.Method, detail: "func(code uint64)" },
    { label: "EnrollTile", kind: LK.Method, detail: "func(t Tile)" },
    { label: "EnrollBatch", kind: LK.Method, detail: "func(ts []Tile)" },
    { label: "AggregateFanout", kind: LK.Method, detail: "func() uint32" },
    { label: "PartitionByLod", kind: LK.Method, detail: "func() map[uint8][]Tile" },
    { label: "RehomeByLod", kind: LK.Method, detail: "func(byLod map[uint8][]Tile) (uint32, error)" },
    { label: "band.Ceiling", kind: LK.Field, detail: "uint8" }, // deep completion
    { label: "NewStripe().Enroll", kind: LK.Method, detail: "func(code uint64)" }, // deep completion
    { label: "Domain().String", kind: LK.Method }, // deep completion
    { label: "var!", kind: LK.Snippet },
    { label: "print!", kind: LK.Snippet },
    { label: "append!", kind: LK.Snippet },
  ];
  const kept = items.map((it) => g.goMemberFromCompletionItem(it)).filter((m) => m !== undefined);
  assert.deepStrictEqual(
    kept.map((m) => m.name).sort(),
    ["AggregateFanout", "Enroll", "EnrollBatch", "EnrollTile", "PartitionByLod", "RehomeByLod"],
    "exactly the six real members survive — nothing dropped, nothing non-identifier kept",
  );
});

gtest("two-rule filter, transcribed slice site: 12 postfix snippets and zero real members filter to EMPTY [surface: scout 'a slice receiver gets 12 of these and zero fake members']", () => {
  const snippets = ["append!", "copy!", "for!", "forr!", "range!", "len!", "print!", "reverse!", "sort!", "var!", "last!", "ifnotnil!"]
    .map((label) => ({ label, kind: LK.Snippet }));
  const kept = snippets.map((it) => g.goMemberFromCompletionItem(it)).filter((m) => m !== undefined);
  assert.deepStrictEqual(kept, [], "the slice site filters to EMPTY, never to snippets");
});

// ===========================================================================
// parseGoReceiverSymbol — the receiver-sibling join's name parse
// ===========================================================================

gtest("parseGoReceiverSymbol: pointer, value, and generic receiver forms parse to {receiver, member} [surface: goal 'methods arrive as top-level (*Widget).Resize documentSymbols, parse the receiver out of the name prefix']", () => {
  for (const [name, receiver, member] of [
    ["(*Stripe).Enroll", "Stripe", "Enroll"],
    ["(*Stripe).RehomeByLod", "Stripe", "RehomeByLod"],
    ["(Stripe).Clone", "Stripe", "Clone"],
    ["(Tile).SubtendedChildren", "Tile", "SubtendedChildren"],
    ["(LodBand).Spans", "LodBand", "Spans"],
    ["(*Cache[K, V]).Get", "Cache", "Get"],
    ["(Cache[T]).Len", "Cache", "Len"],
  ]) {
    const parsed = g.parseGoReceiverSymbol(name);
    assert.ok(parsed, `${JSON.stringify(name)} parses as a method symbol`);
    assert.strictEqual(parsed.receiver, receiver, `${name} -> receiver ${receiver}`);
    assert.strictEqual(parsed.member, member, `${name} -> member ${member}`);
  }
});

gtest("parseGoReceiverSymbol: plain non-method names (functions, types) -> undefined [surface: the join must never claim a free function as a method]", () => {
  for (const name of ["NewStripe", "TileFromMorton", "Stripe", "Tile", "main", ""]) {
    assert.strictEqual(g.parseGoReceiverSymbol(name), undefined, `${JSON.stringify(name)} is not a receiver-prefixed method name`);
  }
});

// ===========================================================================
// parseGoHover — signature fence / doc prose / pkg.go.dev link section
// ===========================================================================

const HOVER_FULL = [
  "```go",
  "func NewStripe() *Stripe",
  "```",
  "",
  "---",
  "",
  "NewStripe returns an empty stripe spanning every lod.",
  "",
  "",
  "---",
  "",
  "[`atlas.NewStripe` on pkg.go.dev](https://pkg.go.dev/example.com/atlasspike/atlas#NewStripe)",
].join("\n");

gtest("parseGoHover: the ```go fence is the signature, the ---separated prose is doc, and the trailing pkg.go.dev link section is NOT doc prose [surface: scout 'hover carries signature + doc prose + a pkg.go.dev link']", () => {
  const h = g.parseGoHover(HOVER_FULL);
  assert.ok(h, "a go-fenced hover parses");
  assert.strictEqual(h.signature.trim(), "func NewStripe() *Stripe", "the fence body is the signature");
  assert.ok(typeof h.doc === "string" && h.doc.includes("empty stripe spanning every lod"), `the prose section is doc, got ${JSON.stringify(h.doc)}`);
  assert.ok(!h.doc.includes("pkg.go.dev"), "the link section never leaks into doc");
});

gtest("parseGoHover: no go fence -> undefined (an unresolved/doc-only hover degrades to no injection, not a guess) [surface: pinned 'undefined when no go fence']", () => {
  assert.strictEqual(g.parseGoHover("just prose, no fence"), undefined, "fenceless -> undefined");
  assert.strictEqual(g.parseGoHover(""), undefined, "empty -> undefined");
});

gtest("parseGoHover: a fence-only hover has a signature and no doc [surface: pinned shape — doc only when prose is present]", () => {
  const h = g.parseGoHover("```go\nfunc (s *Stripe) Enroll(code uint64)\n```");
  assert.ok(h, "parses");
  assert.strictEqual(h.signature.trim(), "func (s *Stripe) Enroll(code uint64)");
  assert.strictEqual(h.doc, undefined, "no prose -> no doc");
});

gtest("parseGoHover: fence + divider + ONLY a link section -> no pkg.go.dev text ever reads as doc [surface: 'the link section is NOT doc prose']", () => {
  const h = g.parseGoHover([
    "```go",
    "func (t Tile) SubtendedChildren() uint32",
    "```",
    "",
    "---",
    "",
    "[`(atlas.Tile).SubtendedChildren` on pkg.go.dev](https://pkg.go.dev/example.com/atlasspike/atlas#Tile.SubtendedChildren)",
  ].join("\n"));
  assert.ok(h, "parses");
  assert.strictEqual(h.signature.trim(), "func (t Tile) SubtendedChildren() uint32");
  assert.ok(!(h.doc || "").includes("pkg.go.dev"), `doc is empty or link-free, got ${JSON.stringify(h.doc)}`);
});
