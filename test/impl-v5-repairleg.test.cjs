// Implementer edge tests for the repair leg (v5 goal item 6), complementing the
// blind oracle (test/blind-v5-repairleg.test.cjs): the exact repro shapes, deep
// import paths, and the amplification-prevention narrative (the classifier never
// hands the repair machinery an external crate to chase for a local name).
//
// Run: SKIP_LIVE=1 node --test test/impl-v5-repairleg.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v5-repairleg",
  `export { classifyHallucination, assembleLocalSymbolPayload } from "../src/core/compilerDirected";\n`
);
const { classifyHallucination, assembleLocalSymbolPayload } = mod;
test.after(cleanup);

const primarySpan = (over = {}) => ({
  fileName: "src/fns.rs",
  byteStart: 0, byteEnd: 0,
  lineStart: 5, lineEnd: 5, columnStart: 12, columnEnd: 20,
  isPrimary: true, ...over,
});
const CURSOR = { line: 4, character: 11 };
const diag = (over = {}) => ({
  kind: "compile-error", level: "error", code: undefined,
  message: "", spans: [primarySpan()], suggestions: [], ...over,
});
const LOCAL = new Set(["CohortRegister"]);

// The flagship repro: `use atlas::CohortRegister;` where CohortRegister is a
// same-file pub struct. Must be local-symbol, never wrong-item(atlas).
test("repro: E0432 `use atlas::CohortRegister` with a local CohortRegister -> local-symbol", () => {
  const d = diag({ code: "E0432", message: "unresolved import `atlas::CohortRegister`" });
  assert.deepStrictEqual(classifyHallucination(d, undefined, LOCAL), {
    kind: "local-symbol", name: "CohortRegister", cursor: CURSOR,
  });
});

// A deep import path: the LEAF is what matters, not the crate/module chain.
test("deep path `use a::b::c::CohortRegister` leaf-local -> local-symbol", () => {
  const d = diag({ code: "E0432", message: "unresolved import `a::b::c::CohortRegister`" });
  const cls = classifyHallucination(d, undefined, LOCAL);
  assert.strictEqual(cls.kind, "local-symbol");
  assert.strictEqual(cls.name, "CohortRegister");
});

// Amplification prevention: without localDefs it is wrong-item(atlas) — the class
// that injects atlas surface. WITH localDefs it never names a crate at all.
test("amplification: the local class carries NO crate to chase", () => {
  const d = diag({ code: "E0432", message: "unresolved import `atlas::CohortRegister`" });
  const withLocal = classifyHallucination(d, undefined, LOCAL);
  assert.ok(!("crate" in withLocal), "local-symbol has no crate field to resolve surface from");
  const without = classifyHallucination(d);
  assert.deepStrictEqual(without, { kind: "wrong-item", crate: "atlas", item: "CohortRegister", cursor: CURSOR });
});

// Guard: a wrong METHOD on a real local type is a genuine repair, NOT local-symbol
// (rust-analyzer resolves local members; the type exists, the method is wrong).
test("guard: E0599 wrong method on a local type stays unresolved-method", () => {
  const d = diag({ code: "E0599", message: "no method named `count` found for struct `CohortRegister`" });
  assert.deepStrictEqual(classifyHallucination(d, undefined, LOCAL), {
    kind: "unresolved-method", member: "count", type: "CohortRegister", cursor: CURSOR,
  });
});

// E0425/E0412 inline field path: `x: atlas::CohortRegister` with a local leaf.
test("E0412 inline `atlas::CohortRegister` leaf-local -> local-symbol", () => {
  const d = diag({ code: "E0412", message: "cannot find type `CohortRegister` in crate `atlas`" });
  assert.strictEqual(classifyHallucination(d, undefined, LOCAL).kind, "local-symbol");
});

// LIVE-P4 finding + structural rule: E0599 means "a member the type does not
// have", whatever rustc's wording. The classifier must key on the CODE, not
// enumerate message shapes (whack-a-mole). All these E0599 variants must inject
// the receiver type's members so the repair can converge; only the bounds-unmet
// form (a different problem) is excluded.
const e0599Cases = [
  {
    name: "`Type is not an iterator` (invented name is a std-trait method like count)",
    msg: "`CohortRegister` is not an iterator",
    type: "CohortRegister",
  },
  {
    name: "a future/unknown E0599 phrasing still steers to member surface",
    msg: "some new rustc wording about `CohortRegister` we have not seen",
    type: "CohortRegister",
  },
];
for (const c of e0599Cases) {
  test(`E0599 structural: ${c.name} -> unresolved-method(type)`, () => {
    const cls = classifyHallucination(diag({ code: "E0599", message: c.msg }), undefined, LOCAL);
    assert.strictEqual(cls && cls.kind, "unresolved-method", "resolves the receiver's member surface");
    assert.strictEqual(cls.type, c.type, "type hint = last backticked token");
  });
}

test("E0599 carve-out: `trait bounds were not satisfied` -> undefined (not a wrong member)", () => {
  const d = diag({
    code: "E0599",
    message: "the method `frobnicate` exists for struct `CohortRegister`, but its trait bounds were not satisfied",
  });
  assert.strictEqual(classifyHallucination(d, undefined, LOCAL), undefined, "bounds-unmet rides plain repair");
});

// The payload: names the symbol, says drop the import, shows no crate surface.
test("assembleLocalSymbolPayload steers drop-not-inject", () => {
  const p = assembleLocalSymbolPayload({ name: "CohortRegister" });
  assert.ok(p.includes("CohortRegister"), "names the symbol");
  assert.ok(/remove|drop|delete/i.test(p) && /use|import|path/i.test(p), "instructs removal of the import/path");
  assert.ok(/in this file|local|not an item of any external crate/i.test(p), "asserts it is local");
  assert.ok(!p.includes("```"), "no code fence — there is no crate surface to show");
});
