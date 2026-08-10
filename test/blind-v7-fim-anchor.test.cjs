// v7 Phase-4 fix guards (review-phase4 F1 + F3), headless.
// F1: findTypeAnchorInText must NOT anchor in a header comment (definition() there
//     resolves nothing -> whole-block injects nothing); it prefers a `use` import.
// F3: wholeBlockSite / typesInPlay must exclude generic params + trait bounds.
//
// Run: node --test test/blind-v7-fim-anchor.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v7-fim-anchor",
  `export { findTypeAnchorInText, typesInPlay, wholeBlockSite } from "../src/core/fimWholeBlock";\n`
);
const { findTypeAnchorInText, typesInPlay, wholeBlockSite } = mod;
test.after(cleanup);

// Mirrors the real fixture: the header COMMENT names the types on lines 0-1
// BEFORE the `use` import and the signature. A first-in-file scan lands in the
// comment (the confirmed bug); the anchor must skip comments / prefer the use.
const DOC = `// Order and Tile are the domain types this consumer maps over.
// The customer town is Order.placed_by.ship_to.locale.
use crate::domain::{Customer, Order};

pub fn town(o: &Order) -> String {
}
`;

test("F1: findTypeAnchorInText anchors at the `use` import, NOT the header comment", () => {
  const at = findTypeAnchorInText(DOC, "Order");
  assert.ok(at, "Order must anchor somewhere");
  const line = DOC.split("\n")[at.line];
  assert.ok(!line.trimStart().startsWith("//"), `must NOT anchor in a comment line; got line ${at.line}: ${JSON.stringify(line)}`);
  assert.match(line, /^use\s/, `should prefer the use import; got: ${JSON.stringify(line)}`);
});

test("F1: a type only present in comments (not code) does not anchor", () => {
  const commentOnly = `// mentions Ghost here\nfn f() {}\n`;
  assert.strictEqual(findTypeAnchorInText(commentOnly, "Ghost"), undefined, "a comment-only type must not anchor");
});

test("F1: falls back to the first NON-COMMENT reference when there is no use line", () => {
  const doc = `// Widget is great\nfn f(w: &Widget) {\n}\n`;
  const at = findTypeAnchorInText(doc, "Widget");
  assert.ok(at, "Widget must anchor at its signature reference");
  assert.ok(!doc.split("\n")[at.line].trimStart().startsWith("//"), "not the comment line");
  assert.match(doc.split("\n")[at.line], /fn f/, "the signature reference");
});

test("F3: typesInPlay excludes generic params and their trait bounds, keeps concrete user types", () => {
  const types = typesInPlay("fn f<T: Trait>(x: T, o: &Order) -> u64");
  assert.ok(types.includes("Order"), `keeps the concrete Order; got ${JSON.stringify(types)}`);
  assert.ok(!types.includes("T"), `excludes the generic param T; got ${JSON.stringify(types)}`);
  assert.ok(!types.includes("Trait"), `excludes the trait bound Trait; got ${JSON.stringify(types)}`);
});

test("F3: wholeBlockSite over a generic signature yields only the concrete type", () => {
  const site = wholeBlockSite("pub fn map_all<T: Clone>(items: &[T], tile: &Tile) -> Vec<u32> {\n    ");
  assert.ok(site, "an empty-body generic fn over Tile is a whole-block site");
  assert.deepStrictEqual(site.types, ["Tile"], `only the concrete Tile; got ${JSON.stringify(site.types)}`);
});

test("F3: std container/prelude types are not types-in-play", () => {
  const types = typesInPlay("fn f(v: Vec<u32>, m: HashMap<u32, String>) -> Option<u64>");
  assert.deepStrictEqual(types, [], `Vec/HashMap/String/Option are std, not derivable; got ${JSON.stringify(types)}`);
});
