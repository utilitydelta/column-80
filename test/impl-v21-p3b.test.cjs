// IMPLEMENTATION tests for the phase 3b whole-block surface: the edges the blind
// contract set cannot see from outside.
//
//   - The hover-signature cap: it is now 32, it BOUNDS (a type past it is not
//     fully signed), and when it binds the callables are not wholly starved by a
//     fields-first declaration order (the >cap case the blind fakes, all <=16
//     members, never reach).
//   - renderWholeBlockInjection's RENDERED budget: the boundary is exact (a block
//     one char over the budget drops its last line), the header-only degrade
//     returns undefined, and every non-empty line still carries its comment prefix.
//   - The §1b settle: a set that never warms terminates (no hang) and stays empty;
//     a set with a real signed member on the first touch is not re-polled.
//   - §3c: the enclosing method name is excluded however the doc spells it.
//
// Run: SKIP_LIVE=1 node --test test/impl-v21-p3b.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v21-p3b",
  `export * as extraction from "../src/core/extraction";\n` +
    `export * as whole from "../src/core/fimWholeBlock";\n` +
    `export * as cross from "../src/core/crossFileShape";\n`,
);
test.after(() => cleanup());

const { extraction, whole, cross } = mod;
const { membersWithHoverSignatures, HOVER_SIGNATURE_CAP } = extraction;
const { renderWholeBlockInjection } = whole;

const BOUNDS = { D_MAX: 4, B_MAX: 8, N_MAX: 64, TOK_MAX: 100000 };

// ---------------------------------------------------------------------------
// The hover-signature cap.
// ---------------------------------------------------------------------------

const roleId = (kind) => kind;
const buildMember = (label, detail, kind) => ({
  name: label,
  kind,
  signature: typeof detail === "string" && detail.length > 0 ? detail : undefined,
});

// A container of `fields` (declared first) then `methods`, each a detail-less node
// at its own line; the hover answers instantly and names the member.
function memberType(fields, methods) {
  const members = [];
  const sigByLine = new Map();
  let line = 1;
  const push = (name, kind) => {
    const ln = line++;
    members.push({
      name,
      kind,
      range: { start: { line: ln, character: 0 }, end: { line: ln, character: 60 } },
      selectionRange: { start: { line: ln, character: 4 }, end: { line: ln, character: 4 + name.length } },
    });
    sigByLine.set(ln, kind === "field" ? `${name}: int` : `${name}(self) -> int`);
  };
  for (const f of fields) push(f, "field");
  for (const m of methods) push(m, "method");
  return {
    symbols: [{ name: "T", kind: "container", range: { start: { line: 0, character: 0 }, end: { line: 1e5, character: 0 } }, children: members }],
    cursor: { uri: "file:///w", line: 0, character: 1 },
    hoverSignatureAt: async (at) => sigByLine.get(at.line),
  };
}
const signed = (ms) => ms.filter((m) => m.signature !== undefined);
const call = async (t, opts) => membersWithHoverSignatures(t.symbols, t.cursor, roleId, buildMember, t.hoverSignatureAt, opts);

test("the cap is 32 (the whole-block surface is no longer bound at the old 8)", () => {
  assert.strictEqual(HOVER_SIGNATURE_CAP, 32);
});

test("a type at exactly the cap signs every member", async () => {
  const methods = Array.from({ length: 32 }, (_, i) => `m${i}`);
  assert.strictEqual(signed(await call(memberType([], methods))).length, 32);
});

test("the cap BOUNDS: a type past it is signed only up to the cap, never invented past it", async () => {
  const methods = Array.from({ length: 50 }, (_, i) => `m${i}`);
  const out = await call(memberType([], methods));
  assert.strictEqual(signed(out).length, 32, "signed count is capped at 32");
  assert.strictEqual(out.length, 50, "every member is still present (bare past the cap)");
});

test(">cap and fields-first: the callables are NOT wholly starved (the §1a invariant past the cap the blind fakes never reach)", async () => {
  // 40 fields declared before 20 methods, cap 32. Pure descent order would sign 32
  // fields and zero methods; the round-robin deal must leave callables represented.
  const fields = Array.from({ length: 40 }, (_, i) => `f${i}`);
  const methods = Array.from({ length: 20 }, (_, i) => `call${i}`);
  const out = await call(memberType(fields, methods));
  const signedMethods = out.filter((m) => m.kind === "method" && m.signature !== undefined);
  assert.strictEqual(signed(out).length, 32, "still bounded by the cap");
  assert.ok(signedMethods.length >= 1, `a fields-first >cap type must still surface a callable; got ${signedMethods.length}`);
});

test("below the cap, order is untouched: every eligible member is signed regardless of kind (round-robin is a no-op)", async () => {
  const fields = Array.from({ length: 5 }, (_, i) => `f${i}`);
  const methods = Array.from({ length: 5 }, (_, i) => `m${i}`);
  const out = await call(memberType(fields, methods));
  assert.strictEqual(signed(out).length, 10, "all 10 signed");
  // Member array order preserved (fields then methods).
  assert.deepStrictEqual(out.map((m) => m.name), [...fields, ...methods]);
});

test("an explicit cap option still overrides the default", async () => {
  const methods = Array.from({ length: 20 }, (_, i) => `m${i}`);
  assert.strictEqual(signed(await call(memberType([], methods), { cap: 4 })).length, 4);
});

// ---------------------------------------------------------------------------
// renderWholeBlockInjection: the RENDERED budget boundary.
// ---------------------------------------------------------------------------

const graph = (methodsByType) => ({
  resolveStruct: (t) => (methodsByType[t] ? { def: `class ${t}`, fields: [], methods: methodsByType[t] } : undefined),
  methodsOf: (t) => methodsByType[t] ?? [],
});

test("the rendered block never exceeds the budget, and the header + every `// ` prefix are inside it", () => {
  const methods = Array.from({ length: 30 }, (_, i) => `int Member${i}(Region r)`);
  const g = graph({ M: methods });
  for (const budget of [80, 120, 200, 400, 1200]) {
    const block = renderWholeBlockInjection(["M"], g.resolveStruct, g.methodsOf, BOUNDS, budget, "//");
    if (block === undefined) continue;
    assert.ok(block.length <= budget, `budget ${budget}: rendered ${block.length}`);
    for (const line of block.split("\n")) {
      assert.ok(line.startsWith("//"), `every line is a comment; offending ${JSON.stringify(line)}`);
    }
  }
});

test("the boundary is exact: dropping one line brings a just-over block within budget", () => {
  const methods = Array.from({ length: 12 }, (_, i) => `int M${i}()`);
  const g = graph({ M: methods });
  // Find the smallest budget at which the FULL block renders, then one char less
  // must drop at least a line and stay within.
  const full = renderWholeBlockInjection(["M"], g.resolveStruct, g.methodsOf, BOUNDS, 100000, "//");
  const tight = renderWholeBlockInjection(["M"], g.resolveStruct, g.methodsOf, BOUNDS, full.length - 1, "//");
  assert.ok(tight === undefined || tight.length <= full.length - 1, "a one-char-tighter budget is honored");
  assert.ok(tight === undefined || tight.split("\n").length < full.split("\n").length, "it dropped at least a line");
});

test("a budget too small for even the header degrades to undefined, never a partial header", () => {
  const g = graph({ M: ["int A()"] });
  const block = renderWholeBlockInjection(["M"], g.resolveStruct, g.methodsOf, BOUNDS, 5, "//");
  assert.strictEqual(block, undefined);
});

test("nothing resolvable is undefined (honest degrade), unchanged", () => {
  const g = graph({});
  assert.strictEqual(renderWholeBlockInjection(["Absent"], g.resolveStruct, g.methodsOf, BOUNDS, 1200, "//"), undefined);
});

// F1: a root with a LOCAL struct field emits a nested def; the root's own methods
// must still attribute to the ROOT, not to the nested def the walk emitted.
test("F1: a root's own methods attribute to the root, never to a nested-field type emitted after the root def", () => {
  // Root `Order` has a field of local type `Customer` (a nested def), and its own
  // method `Total`. The walk emits Order's def then Customer's def; Order's method
  // must land between them (or otherwise be attributable to Order), never after
  // Customer.
  const resolveStruct = (t) => {
    if (t === "Order") return { def: "class Order", fields: [{ name: "buyer", typeName: "Customer", isLocal: true }], methods: [] };
    if (t === "Customer") return { def: "class Customer", fields: [], methods: [] };
    return undefined;
  };
  const methodsOf = (t) => (t === "Order" ? ["decimal Total()"] : []);
  const block = renderWholeBlockInjection(["Order"], resolveStruct, methodsOf, BOUNDS, 4000, "//");
  assert.ok(block, "renders");
  assert.match(block, /class Customer/, "the nested field type is emitted");
  const mIdx = block.indexOf("Total");
  const orderIdx = block.lastIndexOf("Order", mIdx);
  const custIdx = block.lastIndexOf("Customer", mIdx);
  assert.ok(orderIdx > custIdx, `Order's method Total must attribute to Order, not Customer; Order@${orderIdx} Customer@${custIdx}`);
});

// R2-F1: a root that is ALSO an earlier root's field type has its def emitted under
// that earlier root (dedup); its own methods must still attribute to IT, by name,
// not to whatever nested def happens to precede them.
test("R2-F1: every root's methods attribute to its OWN type even when the root is another root's field type", () => {
  const resolveStruct = (t) => {
    if (t === "A") return { def: "class A", fields: [{ name: "b", typeName: "B", isLocal: true }, { name: "c", typeName: "C", isLocal: true }], methods: [] };
    if (t === "B") return { def: "class B", fields: [], methods: [] };
    if (t === "C") return { def: "class C", fields: [], methods: [] };
    return undefined;
  };
  const methodsOf = (t) => ({ A: ["int DoA()"], B: ["int DoB()"], C: ["int DoC()"] }[t] ?? []);
  const block = renderWholeBlockInjection(["A", "B", "C"], resolveStruct, methodsOf, BOUNDS, 4000, "//");
  assert.ok(block, "renders");
  // v22 re-budget: a method is owned by the type-name most-recently PRECEDING it,
  // via its `Type:` anchor (methods-first order) OR its `class Type` def — whichever
  // is nearer. Mechanism-free: holds under the old def-first AND the new anchor-first
  // layout. (Was asserted only via `class Type`, which trailed the method after the
  // re-budget moved defs last; the invariant is unchanged, only where the anchor sits.)
  const ownerIdx = (type, before) =>
    Math.max(block.lastIndexOf(`${type}:`, before), block.lastIndexOf(`class ${type}`, before));
  for (const [type, method] of [["A", "DoA"], ["B", "DoB"], ["C", "DoC"]]) {
    const mi = block.indexOf(method);
    const own = ownerIdx(type, mi);
    assert.ok(own >= 0, `${method} is attributable to ${type} (an anchor or def precedes it)`);
    // no OTHER type's anchor/def may sit between this type's and its method
    for (const other of ["A", "B", "C"].filter((x) => x !== type)) {
      const oi = ownerIdx(other, mi);
      assert.ok(own > oi, `${method} must attribute to ${type} (@${own}), not ${other} (@${oi})`);
    }
  }
});

// R2-F2: a def carrying an internal blank line must not be shattered — no method
// line splices into its body, and no unclosed brace ships at a tight budget.
test("R2-F2: a def with an internal blank line renders as one contiguous block, never shattered", () => {
  const emptyStruct = "struct X {\n\n}"; // synthesized empty-field def (renderDerivedDef shape)
  const bigStruct = "struct Big {\n    a: u32,\n\n    b: u32,\n}";
  for (const def of [emptyStruct, bigStruct]) {
    const resolveStruct = (t) => (t === "X" ? { def, fields: [], methods: [] } : undefined);
    const methodsOf = (t) => (t === "X" ? ["fn go(&self) -> u32"] : []);
    for (const budget of [40, 60, 88, 120, 200, 4000]) {
      const block = renderWholeBlockInjection(["X"], resolveStruct, methodsOf, BOUNDS, budget, "//");
      if (block === undefined) continue;
      const opens = (block.match(/\{/g) || []).length;
      const closes = (block.match(/\}/g) || []).length;
      assert.strictEqual(opens, closes, `budget ${budget}: braces balanced (def not shattered); got\n${block}`);
      // the method line must not sit between the def's braces
      const mi = block.indexOf("fn go");
      if (mi >= 0) {
        const open = block.indexOf("{");
        const close = block.indexOf("}");
        assert.ok(!(mi > open && mi < close), `budget ${budget}: method spliced inside the def body:\n${block}`);
      }
    }
  }
});

// F3: a multi-line def is atomic — a budget that fits the header but not the whole
// def emits NONE of the def (never an unclosed brace), while method lines still tail-drop.
test("F3: a multi-line def is never split mid-body (all of it or none), so every block is brace-balanced", () => {
  const bigDef = "class Big {\n  int A;\n  int B;\n  int C;\n  int D;\n}";
  const resolveStruct = (t) => (t === "Big" ? { def: bigDef, fields: [], methods: [] } : undefined);
  const methodsOf = () => [];
  // A budget that fits the header but not the whole def.
  const headerOnly = renderWholeBlockInjection(["Big"], resolveStruct, methodsOf, BOUNDS, 60, "//");
  // Either the whole def rendered, or it degraded to undefined — never a prefix.
  if (headerOnly !== undefined) {
    const opens = (headerOnly.match(/\{/g) || []).length;
    const closes = (headerOnly.match(/\}/g) || []).length;
    assert.strictEqual(opens, closes, `braces balanced (no split def); got ${headerOnly}`);
  }
  // A generous budget renders the whole def, balanced.
  const full = renderWholeBlockInjection(["Big"], resolveStruct, methodsOf, BOUNDS, 4000, "//");
  assert.strictEqual((full.match(/\{/g) || []).length, (full.match(/\}/g) || []).length, "full def is balanced");
});

test("F3: method lines still tail-drop individually when they overrun (the C# overrun shape)", () => {
  const methods = Array.from({ length: 20 }, (_, i) => `int M${i}()`);
  const g = graph({ T: methods });
  const block = renderWholeBlockInjection(["T"], g.resolveStruct, g.methodsOf, BOUNDS, 120, "//");
  assert.ok(block, "renders a partial block");
  assert.ok(block.length <= 120, "within budget");
  const shown = (block.match(/int M\d+\(\)/g) || []).length;
  assert.ok(shown >= 1 && shown < 20, `some but not all methods shown (tail-dropped); got ${shown}`);
});

// ---------------------------------------------------------------------------
// The §1b settle: termination and no false re-poll.
// ---------------------------------------------------------------------------

const DEF_LOC = { uri: "file:///t.py", range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 9 } };
const ROOT = { uri: "file:///m.py", line: 0, character: 0 };
const openFile = async (uri) => (uri === ROOT.uri ? "Foo" : "class Foo:\n    pass\n");
const pyEx = (seq) => {
  let i = 0;
  return {
    definition: async () => DEF_LOC,
    hoverSurface: async () => ({ signature: "class Foo" }),
    membersOfType: async () => seq[Math.min(i++, seq.length - 1)],
  };
};

test("§1b: a set that never warms terminates and stays method-less (no hang, no invention)", async () => {
  const ctor = [{ name: "__init__", kind: "method", signature: "__init__(self) -> None" }];
  const shape = await cross.resolveCrossFileShape(pyEx([ctor]), ROOT, { D_MAX: 2, N_MAX: 8 }, openFile, cross.pyShapeHooks);
  const foo = shape.types.get("Foo");
  assert.ok(foo, "Foo resolves via hover");
  assert.strictEqual(foo.methods.length, 0, "a genuinely constructor-only type reads as method-less, not invented");
});

// F2: a fully-settled field-only struct (fields carry no signature - the Rust data
// struct shape) must NOT re-poll: renderMethods is empty but a re-poll cannot add a
// method, so the 3x40ms settle delay must not fire. The cold Python shape (an
// unsigned callable still pending) MUST still re-poll and recover its methods.
test("F2: a field-only (unsigned, non-callable) set does not re-poll - no 120ms burned recovering nothing", async () => {
  const fieldOnly = [
    { name: "alpha", kind: "field", signature: undefined },
    { name: "beta", kind: "field", signature: undefined },
  ];
  const start = process.hrtime.bigint();
  const shape = await cross.resolveCrossFileShape(pyEx([fieldOnly]), ROOT, { D_MAX: 2, N_MAX: 8 }, openFile, cross.pyShapeHooks);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(shape.types.get("Foo"), "Foo resolves");
  assert.ok(ms < 60, `a settled field-only set must not incur the 3x40ms re-poll; took ${ms.toFixed(1)}ms`);
});

test("F2: the cold shape - an unsigned callable still pending - DOES re-poll and recovers its methods", async () => {
  const cold = [
    { name: "__init__", kind: "method", signature: "__init__(self) -> None" }, // signed ctor, dropped
    { name: "run", kind: "method", signature: undefined }, // unsigned callable, pending
  ];
  const warm = [{ name: "run", kind: "method", signature: "run(self) -> int" }];
  const shape = await cross.resolveCrossFileShape(pyEx([cold, warm]), ROOT, { D_MAX: 2, N_MAX: 8 }, openFile, cross.pyShapeHooks);
  assert.deepStrictEqual(shape.types.get("Foo").methods, ["run(self) -> int"], "the pending callable warms in on the re-poll");
});

test("§1b: a first touch that already carries a real method is used as-is (no needless re-poll changes the answer)", async () => {
  const warm = [{ name: "go", kind: "method", signature: "go(self) -> int" }];
  const shape = await cross.resolveCrossFileShape(pyEx([warm, []]), ROOT, { D_MAX: 2, N_MAX: 8 }, openFile, cross.pyShapeHooks);
  assert.deepStrictEqual(shape.types.get("Foo").methods, ["go(self) -> int"]);
});
