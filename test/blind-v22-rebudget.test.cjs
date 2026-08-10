// BLIND ORACLE — session-v22: the whole-block RE-BUDGET / arm-C render shape for
// renderWholeBlockInjection. Black-box contract test against the exported surface
// ONLY (src/core/fimWholeBlock.ts). This file NEVER opens the body of the function
// under test; it drives the settled, exported signature with HAND-BUILT
// resolveStruct/methodsOf fakes and asserts the CONTRACT invariants of
// session/surface-v22.md — not the mechanism the implementer is free to choose.
//
// The new render shape (arm C), top (furthest from cursor) to bottom (adjacent):
//   1. HEADER  `types in play (use these real names, do not invent):`
//   2. METHODS FIRST, grouped by owning type (a `TypeName:` anchor then its sigs)
//   3. DEFS LAST — multi-line brace defs truncate BRACE-SAFE (`... N more fields`
//      marker + close); single-line defs are atomic.
//   4. TERMINATOR  `end of type info - the body follows:` (as a comment).
//
// Expected today: RED for the behaviours that CHANGED — INV-order (methods before
// defs), INV-truncation (brace-safe partial def + marker), INV-terminator (the
// terminator line), INV-whole for multi-line defs (each field its own comment
// line). GREEN for what did NOT change — INV-brace, INV-budget, INV-degrade, the
// "every non-empty line is a comment" rule.
//
// Run: SKIP_LIVE=1 node --test test/blind-v22-rebudget.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v22-rebudget",
  `export { renderWholeBlockInjection, createInjectionCache } from "../src/core/fimWholeBlock";\n`,
);
const { renderWholeBlockInjection } = mod;
test.after(cleanup);

// The exact settled strings (surface-v22.md §"The new render shape").
const HEADER = "types in play (use these real names, do not invent):";
const TERMINATOR = "end of type info - the body follows:";

// A generous 2-D walk bound: only the aggregate `tokenBudget` char budget binds,
// never the per-walk cap — the contract here is about the aggregate.
const BOUNDS = { D_MAX: 4, B_MAX: 8, N_MAX: 64, TOK_MAX: 100000 };
const BIG_BUDGET = 100000; // deliberately non-binding in shape tests

// ---- fake builders -------------------------------------------------------
// A def carries a `<<DEF Name>>` sentinel in its header line so "was THIS def
// rendered" is readable no matter how it is rendered. A multi-line brace def
// tokenises each field line `FIELD_Name_i` so shown/dropped counts are readable.

const multilineDef = (name, k) => {
  const fields = Array.from({ length: k }, (_, i) => `    FIELD_${name}_${i}: u32,`);
  return `<<DEF ${name}>> struct ${name} {\n${fields.join("\n")}\n}`;
};
const singleLineDef = (name) => `<<DEF ${name}>> class ${name}`;

// spec: { Name: { def, methods } }. resolveStruct returns {def, fields:[]} (the
// field body rides in `def` text; the walk needs no nested reachability here since
// roots are passed explicitly). methodsOf returns the signature-string array.
function graph(spec) {
  const map = new Map(Object.entries(spec));
  return {
    resolveStruct: (t) => (map.has(t) ? { def: map.get(t).def, fields: [] } : undefined),
    methodsOf: (t) => (map.has(t) ? map.get(t).methods || [] : []),
  };
}

const render = (roots, g, budget, lc) =>
  renderWholeBlockInjection(roots, g.resolveStruct, g.methodsOf, BOUNDS, budget, lc);

const nonEmptyLines = (block) => block.split("\n").filter((l) => l.trim() !== "");
const countChar = (s, ch) => s.split(ch).length - 1;
const LCS = ["//", "#"]; // the two line-comment tokens the contract requires

// ===========================================================================
// INV-order — every method line appears BEFORE every def's field/close content.
// The def block starts at its `<<DEF>>` sentinel; assert the last method token
// precedes the first def sentinel. RED today (today renders defs first).
// ===========================================================================

test("INV-order: every method line precedes every def block (methods first, defs last)", () => {
  const g = graph({
    Order: { def: multilineDef("Order", 3), methods: ["fn METH_Order_0(self) -> u32", "fn METH_Order_1(self) -> u32"] },
    Cust: { def: singleLineDef("Cust"), methods: ["fn METH_Cust_0(self) -> u32"] },
  });
  const block = render(["Order", "Cust"], g, BIG_BUDGET, "//");
  assert.ok(block, "both types resolve into a block");

  const methodTokens = ["METH_Order_0", "METH_Order_1", "METH_Cust_0"];
  const lastMethodIdx = Math.max(...methodTokens.map((t) => block.indexOf(t)));
  const firstDefIdx = block.indexOf("<<DEF");
  for (const t of methodTokens) assert.ok(block.includes(t), `method ${t} rides the block`);
  assert.ok(firstDefIdx !== -1, "at least one def sentinel is present");
  assert.ok(
    lastMethodIdx < firstDefIdx,
    `every method must precede every def; last method @${lastMethodIdx} is not before the first def @${firstDefIdx} ` +
      `(today emits def-first)`,
  );
});

// ===========================================================================
// INV-attribution — a method is owned by the type-name most-recently PRECEDING
// it. Under method-first order that anchor is the `TypeName:` line, NOT a def.
// Two types sharing a method NAME each attribute to a DISTINCT owner. RED today
// (today's preceding-name for a method is a def, and the flat order collapses).
// ===========================================================================

test("INV-attribution: two types sharing a method NAME each attribute to a distinct owner via nearest-preceding type name", () => {
  const g = graph({
    RegionAlpha: { def: singleLineDef("RegionAlpha"), methods: ["fn alphaOnly(self)", "fn sharedMember(self)"] },
    RegionBeta: { def: singleLineDef("RegionBeta"), methods: ["fn betaOnly(self)", "fn sharedMember(self)"] },
  });
  const block = render(["RegionAlpha", "RegionBeta"], g, BIG_BUDGET, "//");
  assert.ok(block, "both types resolve");

  const occ = [...block.matchAll(/sharedMember/g)].map((m) => m.index);
  assert.strictEqual(occ.length, 2, `the shared method name appears once per owner; got ${occ.length}`);

  // Owner = the type name whose most-recent occurrence precedes the method line.
  const ownerOf = (idx) => {
    const a = block.lastIndexOf("RegionAlpha", idx);
    const b = block.lastIndexOf("RegionBeta", idx);
    return a === b ? undefined : a > b ? "RegionAlpha" : "RegionBeta";
  };
  const owners = occ.map(ownerOf);
  assert.ok(
    owners[0] !== undefined && owners[1] !== undefined && owners[0] !== owners[1],
    `each shared-name occurrence must attribute to a DISTINCT owning type; got ${JSON.stringify(owners)}`,
  );
});

// ===========================================================================
// INV-truncation — a multi-line def that does NOT fit whole truncates BRACE-SAFE:
// the header line, 1..K-1 field lines, a `... N more fields` marker (N = K-shown),
// then the closing brace. RED today (today atomic-drops a def that won't fit —
// no marker, no partial). Parameterised over lineComment.
// ===========================================================================

for (const lc of LCS) {
  test(`INV-truncation [${lc}]: a multi-line def that will not fit whole truncates brace-safe with a "... N more fields" marker`, () => {
    const K = 40;
    const g = graph({ Big: { def: multilineDef("Big", K), methods: [] } });

    // Measure the whole rendering, then choose a budget that cannot fit every
    // field but comfortably fits header + def header + close + terminator + many
    // fields — forcing a partial def (some but not all fields).
    const whole = render(["Big"], g, BIG_BUDGET, lc);
    assert.ok(whole, "the def renders whole at a non-binding budget");
    const budget = Math.floor(whole.length * 0.6);

    const block = render(["Big"], g, budget, lc);
    assert.ok(block, `a partial def must still render (budget=${budget}); got undefined (atomic-drop is the old behaviour)`);
    assert.ok(block.length <= budget, `the truncated block stays within budget; ${block.length} <= ${budget}`);

    const m = block.match(/\.\.\. (\d+) more fields/);
    assert.ok(m, `the brace-safe truncation marker "... N more fields" must appear; block was:\n${block}`);
    const shown = [...block.matchAll(/FIELD_Big_\d+/g)].length;
    assert.ok(shown >= 1 && shown < K, `1..K-1 field lines are shown; shown=${shown} of ${K}`);
    assert.strictEqual(
      Number(m[1]),
      K - shown,
      `marker N must equal fields dropped (K-shown = ${K - shown}); marker said ${m[1]}`,
    );

    // The close still follows the marker and braces stay balanced.
    assert.ok(block.lastIndexOf("}") > m.index, "the closing brace follows the truncation marker");
    assert.strictEqual(countChar(block, "{"), countChar(block, "}"), "the truncated def is still brace-balanced");
  });
}

test("INV-truncation: a budget too small for even header + close omits the def entirely (no header-only stub)", () => {
  const g = graph({ Big: { def: multilineDef("Big", 40), methods: [] } });
  const block = render(["Big"], g, 12, "//"); // far below any single line
  assert.strictEqual(block, undefined, "no def fits => undefined, never a header/terminator with no content");
});

// ===========================================================================
// INV-whole — a multi-line def that FITS whole emits every field line (each its
// own comment line) and NO marker. A single-line def that fits emits verbatim.
// The per-field-comment-line part is RED today (today does not brace-render a
// multi-line def as individually-prefixed comment lines).
// ===========================================================================

test("INV-whole: a multi-line def that fits whole emits every field line as its own comment line, with no marker", () => {
  const K = 6;
  const g = graph({ Rec: { def: multilineDef("Rec", K), methods: [] } });
  const block = render(["Rec"], g, BIG_BUDGET, "//");
  assert.ok(block, "the def renders whole");

  assert.ok(!/\.\.\. \d+ more fields/.test(block), "a whole def carries NO truncation marker");
  for (let i = 0; i < K; i++) {
    const token = `FIELD_Rec_${i}`;
    assert.ok(block.includes(token), `field ${token} is present in the whole def`);
    const line = block.split("\n").find((l) => l.includes(token));
    assert.ok(line.startsWith("//"), `each field line is its own comment line; offending: ${JSON.stringify(line)}`);
  }
  assert.strictEqual(countChar(block, "{"), countChar(block, "}"), "brace-balanced");
});

test("INV-whole: a single-line def that fits is emitted verbatim (atomic)", () => {
  const g = graph({ Foo: { def: singleLineDef("Foo"), methods: [] } });
  const block = render(["Foo"], g, BIG_BUDGET, "//");
  assert.ok(block, "the single-line def renders");
  assert.match(block, /<<DEF Foo>> class Foo/, "the single-line def is emitted verbatim");
  assert.ok(!/\.\.\. \d+ more fields/.test(block), "a single-line def is never partial (no marker)");
});

// ===========================================================================
// INV-brace — the block is ALWAYS brace-balanced; a def is never an unclosed
// prefix. GREEN today (atomic-drop keeps balance). Parameterised over budgets.
// ===========================================================================

test("INV-brace: the block is brace-balanced at every budget (never an unclosed def prefix)", () => {
  const g = graph({
    A: { def: multilineDef("A", 20), methods: ["fn a0(self)", "fn a1(self)"] },
    B: { def: multilineDef("B", 15), methods: ["fn b0(self)"] },
  });
  for (const budget of [40, 120, 300, 600, 1200, BIG_BUDGET]) {
    const block = render(["A", "B"], g, budget, "//");
    if (block === undefined) continue; // honest degrade is within contract
    assert.strictEqual(
      countChar(block, "{"),
      countChar(block, "}"),
      `[budget=${budget}] braces must balance; { = ${countChar(block, "{")}, } = ${countChar(block, "}")}`,
    );
  }
});

// ===========================================================================
// INV-budget — the RENDERED block length (header + every prefix + terminator) is
// <= tokenBudget, at every member/field count and budget. GREEN today (shipped
// in v21). Parameterised.
// ===========================================================================

test("INV-budget: the rendered block never overruns tokenBudget (parameterized over counts and budgets)", () => {
  for (const [methods, fields, budget] of [
    [16, 0, 200],
    [40, 8, 300],
    [80, 20, 500],
    [8, 40, 400],
    [160, 40, 900],
  ]) {
    const g = graph({
      Model: {
        def: multilineDef("Model", fields),
        methods: Array.from({ length: methods }, (_, i) => `fn factor${i}(self, r: RegionData) -> f64`),
      },
    });
    const block = render(["Model"], g, budget, "//");
    if (block === undefined) continue; // honest degrade within contract
    assert.ok(
      block.length <= budget,
      `[methods=${methods}, fields=${fields}, budget=${budget}] overrun: ${block.length} > ${budget}`,
    );
  }
});

// ===========================================================================
// INV-terminator — whenever a block is defined, its final non-empty line is the
// terminator, carrying the lineComment prefix. A blank comment line is not it.
// RED today (no terminator). Parameterised over lineComment.
// ===========================================================================

for (const lc of LCS) {
  test(`INV-terminator [${lc}]: the block's final non-empty line is "${TERMINATOR}", carrying the ${lc} prefix`, () => {
    const g = graph({ Order: { def: singleLineDef("Order"), methods: ["fn total(self) -> u32"] } });
    const block = render(["Order"], g, BIG_BUDGET, lc);
    assert.ok(block, "a resolvable root renders a block");
    const lines = nonEmptyLines(block);
    const last = lines[lines.length - 1];
    assert.ok(last.startsWith(lc), `the terminator carries the ${lc} prefix; got ${JSON.stringify(last)}`);
    assert.ok(last.includes(TERMINATOR), `the last non-empty line is the terminator; got ${JSON.stringify(last)}`);
    assert.strictEqual(last.replace(lc, "").trim(), TERMINATOR, "the terminator text is exact");
  });
}

// ===========================================================================
// INV-degrade — nothing resolvable => undefined; a budget too small for even the
// header + terminator + one line of surface => undefined (never a header/terminator
// stub with no content). First clause GREEN today.
// ===========================================================================

test("INV-degrade: nothing resolvable across all roots => undefined", () => {
  const resolveStruct = () => undefined;
  const methodsOf = () => [];
  const block = renderWholeBlockInjection(["Order", "Cust"], resolveStruct, methodsOf, BOUNDS, BIG_BUDGET, "//");
  assert.strictEqual(block, undefined, "no resolvable surface => undefined (degrade to plain FIM)");
});

test("INV-degrade: a budget too small for even one line of surface => undefined (no empty header/terminator stub)", () => {
  const g = graph({ Order: { def: singleLineDef("Order"), methods: ["fn total(self) -> u32"] } });
  const block = render(["Order"], g, 8, "//");
  assert.strictEqual(block, undefined, "a sub-line budget degrades to undefined, not an empty stub");
});

// ===========================================================================
// INV-language — works for lineComment in {//, #}. Every non-empty line is a
// comment. A single-line def under `#` (Python `class Foo`) is atomic. GREEN today
// for the comment rule; parameterised over both tokens.
// ===========================================================================

for (const lc of LCS) {
  test(`INV-language [${lc}]: every non-empty line of a resolvable block is a comment prefixed by ${lc}`, () => {
    const g = graph({
      Widget: {
        def: singleLineDef("Widget"),
        methods: ["fn render(self) -> u32", "fn resize(self, n: u32)"],
      },
    });
    const block = render(["Widget"], g, BIG_BUDGET, lc);
    assert.ok(block, "the block renders");
    for (const line of nonEmptyLines(block)) {
      assert.ok(line.startsWith(lc), `every non-empty line is a ${lc} comment; offending: ${JSON.stringify(line)}`);
    }
    assert.match(block, new RegExp(HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the header is present");
  });
}

test("INV-language [#]: a single-line Python def (class Foo) is atomic — emitted whole or not at all, never partial", () => {
  const g = graph({ Foo: { def: "<<DEF Foo>> class Foo", methods: ["fn method(self)"] } });
  const block = render(["Foo"], g, BIG_BUDGET, "#");
  assert.ok(block, "the python block renders");
  assert.match(block, /<<DEF Foo>> class Foo/, "the single-line def is emitted verbatim under #");
  assert.ok(!/\.\.\. \d+ more fields/.test(block), "a single-line def never carries a truncation marker");
});
