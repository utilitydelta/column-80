// BLIND ORACLE - v6 P4 item 3 (repair leg): the NEW unresolved-field class.
//
// Black-box contract test for the SHIPPED classifier + surface glue against
// SURFACE-p4-item3.md (R1, R2) and investigation-item3.md. Written WITHOUT reading
// the classifyHallucination / resolveSurfaceInjection bodies - only the exported
// signatures, the surface spec, and the impl9 / blind-v6-item1 / blind-v6-item4
// reference patterns for headless bundling.
//
// The change under test:
//   R1 - classifyHallucination gains a NEW class `unresolved-field` from an E0609
//        `no field \`X\` on type \`Y\`` diagnostic, naming the RECEIVER type Y.
//        RED now: the classifier handles only E0425/E0412/E0599/E0432/E0433
//        (grep-confirmed) - E0609 classifies to undefined today.
//   R2 - resolveSurfaceInjection on an unresolved-field injects the DEPTH-1 struct
//        def of Y (its real fields), NOT a recursive walk, coexisting with the
//        item-4 all-eligible combine. RED-or-partial now.
//
// Run: SKIP_LIVE=1 node --test test/blind-v6-item3-classify.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- Bundle exactly as impl9 / blind-v6-item1 do: minimal vscode stub + esbuild
// alias, then require the CJS bundle.
const STUB = path.join(__dirname, ".blind-v6-item3-classify-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`,
);
const entry = path.join(__dirname, ".blind-v6-item3-classify.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item3-classify.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { classifyHallucination } from "../src/core/compilerDirected";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolveSurfaceInjection, classifyHallucination } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// A document over a text string with the offset math the glue uses (from impl9).
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
  // getText() with no range returns the full buffer (real vscode.TextDocument
  // behaviour; the repair field leg now reads the doc to find a receiver-type ref).
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
}

const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 3, isPrimary: true }],
  suggestions: [],
});

// The real rustc E0609 wording: `no field \`X\` on type \`Y\``. (See report: for a
// reference receiver rustc auto-derefs and names the owning type `Order`, not
// `&Order`; this is the faithful canonical form.)
const fieldMiss = (field, type) => `no field \`${field}\` on type \`${type}\``;
const methodMiss = (member, type) => `no method named \`${member}\` found for struct \`${type}\` in the current scope`;

const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);

// ===========================================================================
// R1 - E0609 -> unresolved-field, naming the receiver type. RED now: E0609 is
// unhandled, so classifyHallucination returns undefined.
// ===========================================================================
test("R1: E0609 `no field ... on type Order` classifies to unresolved-field naming Order", () => {
  const c = classifyHallucination(diag("E0609", fieldMiss("city", "Order"), { line: 5, character: 10 }));
  assert.ok(c, `E0609 must classify to a hallucination class (got ${JSON.stringify(c)})`);
  assert.strictEqual(c.kind, "unresolved-field", `the new class is unresolved-field (got ${c && c.kind})`);
  assert.strictEqual(c.type, "Order", `the RECEIVER type Order is named (got ${JSON.stringify(c && c.type)})`);
  // The invented field name is carried too (mirrors member on the other classes).
  assert.ok(
    c.member === "city" || c.field === "city",
    `the invented field name city is carried (got ${JSON.stringify(c)})`,
  );
  // The cursor comes from the primary span (as every other class does).
  assert.deepStrictEqual(c.cursor, { line: 5, character: 10 }, "cursor is the primary span (line-1, col-1)");
});

test("R1b: a deep miss fires E0609 on the nested receiver, naming that type (Customer)", () => {
  // order.customer.addres.city -> E0609 on `.addres`, receiver Customer.
  const c = classifyHallucination(diag("E0609", fieldMiss("addres", "Customer"), { line: 0, character: 0 }));
  assert.strictEqual(c && c.kind, "unresolved-field", `deep miss classifies unresolved-field (got ${c && c.kind})`);
  assert.strictEqual(c && c.type, "Customer", "the rustc-named receiver Customer is the injection root");
});

// ===========================================================================
// R2 - unresolved-field -> DEPTH-1 struct def of the named type (its real
// fields), NOT a recursive walk. The fake extractor offers the receiver's struct
// def / members through both the item2b resolvers (hoverSurface/membersOfType)
// and the item1 resolvers (example/completeMembers), so whichever the impl calls
// for the field class, it resolves Order. Order's REAL fields are id + customer
// (the invented `city` is absent - that is the point). Customer's own def must
// NOT appear: depth-1, not a walk. RED-or-partial now.
// ===========================================================================
function receiverExtractor() {
  const calls = { hoverSurface: 0, membersOfType: 0, example: 0, completeMembers: 0 };
  const ORDER_DEF = "pub struct Order { id: u64, customer: Customer }";
  const ORDER_FIELDS = [
    { name: "id", signature: "id: u64", kind: "field" },
    { name: "customer", signature: "customer: Customer", kind: "field" },
  ];
  return {
    calls,
    hoverSurface: async () => { calls.hoverSurface++; return { signature: ORDER_DEF }; },
    membersOfType: async () => { calls.membersOfType++; return ORDER_FIELDS; },
    example: async () => { calls.example++; return undefined; },
    completeMembers: async () => { calls.completeMembers++; return ORDER_FIELDS; },
  };
}

test("R2: an unresolved-field injects the depth-1 struct def of the receiver, not a recursive walk", async () => {
  const ext = receiverExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x/main.rs"), [
    diag("E0609", fieldMiss("city", "Order"), { line: 2, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced for the unresolved-field class");
  // The receiver's real fields are shown (so the model sees `city` is not one).
  assert.ok(/Order/.test(out), `the payload names the receiver Order; got: ${out}`);
  assert.ok(out.includes("id") && out.includes("customer"), `Order's real fields are shown; got: ${out}`);
  // DEPTH-1 ONLY: the field-type Customer's OWN struct def must not be walked in.
  assert.ok(!out.includes("pub struct Customer"), `depth-1 only - no recursive walk into Customer; got: ${out}`);
});

test("R2b: an unresolved-field coexists with a method miss in the item-4 combine", async () => {
  const ext = receiverExtractor();
  // Give the method-miss receiver its own signatures via completeMembers/example.
  const combined = {
    calls: {},
    hoverSurface: ext.hoverSurface,
    membersOfType: async (cursor) => (cursor && cursor.line === 3
      ? [{ name: "total", signature: "total(&self) -> u64", kind: "method" }]
      : ext.membersOfType()),
    example: async () => undefined,
    completeMembers: async (cursor) => (cursor && cursor.line === 3
      ? [{ name: "total", signature: "total(&self) -> u64", kind: "method" }]
      : ext.completeMembers()),
  };
  const out = surfaceOf(await resolveSurfaceInjection(combined, makeDoc("fn f() {}", "file:///x"), [
    diag("E0609", fieldMiss("city", "Order"), { line: 2, character: 4 }),
    diag("E0599", methodMiss("total", "Ledger"), { line: 3, character: 4 }),
  ], () => {}));
  assert.ok(out, "a combined payload is produced");
  assert.ok(/Order/.test(out), `the unresolved-field surface for Order is present; got: ${out}`);
  assert.ok(out.includes("API surface for `Ledger`"), `the method-miss surface coexists; got: ${out}`);
});
