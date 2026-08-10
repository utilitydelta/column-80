// v7 Phase-3 repair oracle: CURSOR-FAITHFUL fake, unlike the v6 item3 fake that
// returned the receiver's struct regardless of where it was hovered (that masked
// the cross-file/crate gap the review found live). Here hoverSurface resolves the
// struct ONLY at a REAL type reference (the `use` import / signature) and returns
// undefined at the invalid-field access cursor — exactly how rust-analyzer
// behaves. So the OLD field leg (hover at the E0609 field cursor) injects NOTHING
// (red); the fixed leg (hover at the receiver-type reference) injects Y's real
// fields (green). Cross-file (Order in another module) is the case under test.
//
// Run: SKIP_LIVE=1 node --test test/blind-v7-repair-xfile.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v7-repair-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`,
);
const entry = path.join(__dirname, ".blind-v7-repair.entry.ts");
const outfile = path.join(__dirname, ".blind-v7-repair.bundle.cjs");
fs.writeFileSync(entry, `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolveSurfaceInjection } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
    return o + pos.character;
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}

const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/consumer.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 5, isPrimary: true }],
  suggestions: [],
});
const fieldMiss = (field, type) => `no field \`${field}\` on type \`${type}\``;
const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);

const wordAt = (text, cursor) => {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length), e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e);
};

// consumer.rs imports Order (defined in domain.rs) and accesses an invented field.
// `city` is NOT a field of Order; the real fields are reference / placed_by.
const CONSUMER = `use crate::domain::Order;

fn town(o: &Order) -> String {
    o.city.clone()
}
`;
const CONSUMER_URI = "file:///w/src/consumer.rs";
const ORDER_HOVER = "pub struct Order { pub reference: String, pub placed_by: Customer }";

// Cursor-faithful: resolve Order's struct ONLY when the cursor sits on a real
// `Order` token; undefined anywhere else (the invalid `city` field included).
function cursorFaithfulExtractor() {
  const calls = { hoverSurface: [], membersOfType: [], example: [], completeMembers: [] };
  return {
    calls,
    hoverSurface: async (cursor) => {
      calls.hoverSurface.push(cursor);
      return wordAt(CONSUMER, cursor) === "Order" ? { signature: ORDER_HOVER } : undefined;
    },
    // documentSymbol is function-scoped: at an access site it finds no struct.
    membersOfType: async (cursor) => { calls.membersOfType.push(cursor); return []; },
    example: async (...a) => { calls.example.push(a); return undefined; },
    completeMembers: async (...a) => { calls.completeMembers.push(a); return []; },
  };
}

test("repair E0609: a cross-file field miss injects the receiver's REAL fields (hover at the type ref, not the dead field cursor)", async () => {
  const ext = cursorFaithfulExtractor();
  const doc = makeDoc(CONSUMER, CONSUMER_URI);
  // E0609 primary span at the invalid field `city` (line 3, the `city` token).
  const cityLine = CONSUMER.split("\n").findIndex((l) => l.includes("o.city"));
  const cityCol = CONSUMER.split("\n")[cityLine].indexOf("city");
  const out = surfaceOf(
    await resolveSurfaceInjection(ext, doc, [diag("E0609", fieldMiss("city", "Order"), { line: cityLine, character: cityCol })], () => {}),
  );

  assert.ok(out, `a payload must be produced for the cross-file field miss (was NOTHING before the fix). hovers=${JSON.stringify(ext.calls.hoverSurface)}`);
  assert.match(out, /Order/, `names the receiver Order; got: ${out}`);
  assert.ok(out.includes("reference") && out.includes("placed_by"), `Order's REAL fields are injected; got: ${out}`);
  // Nothing invented: the bad field name must not be echoed as a real field.
  assert.ok(!/\bcity\b/.test(out), `the invented field city must not appear; got: ${out}`);
  // Depth-1: the nested field type Customer's own def is not walked in.
  assert.ok(!/pub struct Customer/.test(out), `depth-1 only, no walk into Customer; got: ${out}`);
  // The fix hovered at a real Order reference (use/signature), not only the field.
  const hoveredOrder = ext.calls.hoverSurface.some((c) => wordAt(CONSUMER, c) === "Order");
  assert.ok(hoveredOrder, `repair must hover at a real Order reference; hovers=${JSON.stringify(ext.calls.hoverSurface)}`);
});
