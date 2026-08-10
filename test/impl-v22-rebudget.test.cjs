// IMPLEMENTER tests — session-v22 re-budget (arm C). These complement the blind
// oracle (test/blind-v22-rebudget.test.cjs) by reaching edge cases only visible with
// knowledge of the mechanism: the relaxed-walk fix (an oversized def the OLD walk
// dropped whole now contributes truncated fields), the 0-fields-fit budget corner,
// exact marker accounting, nested-def emission, and non-brace atomic fallbacks.
//
// Run: SKIP_LIVE=1 node --test test/impl-v22-rebudget.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v22-rebudget",
  `export { renderWholeBlockInjection, parseBraceDef } from "../src/core/fimWholeBlock";\n`,
);
const { renderWholeBlockInjection } = mod;
test.after(cleanup);

const HEADER = "types in play (use these real names, do not invent):";
const TERMINATOR = "end of type info - the body follows:";
const BOUNDS = { D_MAX: 4, B_MAX: 8, N_MAX: 64, TOK_MAX: 100000 };
const countChar = (s, ch) => s.split(ch).length - 1;

const multilineDef = (name, k) => {
  const fields = Array.from({ length: k }, (_, i) => `    field_${name}_${i}: u32,`);
  return `struct ${name} {\n${fields.join("\n")}\n}`;
};
const graph = (spec) => {
  const map = new Map(Object.entries(spec));
  return {
    resolveStruct: (t) => (map.has(t) ? { def: map.get(t).def, fields: map.get(t).fields ?? [] } : undefined),
    methodsOf: (t) => (map.has(t) ? map.get(t).methods ?? [] : []),
  };
};
const render = (roots, g, budget, lc = "//") =>
  renderWholeBlockInjection(roots, g.resolveStruct, g.methodsOf, BOUNDS, budget, lc);

// ===========================================================================
// The relaxed-walk fix: a def whose RAW size exceeds tokenBudget was dropped WHOLE
// inside walkDataShape before v22 (goes dark). Now it is DISCOVERED and truncated
// brace-safe at the render pass, so its early fields still reach the block.
// ===========================================================================

test("relaxed walk: a def larger than tokenBudget still contributes truncated fields (not dropped whole)", () => {
  const g = graph({ Huge: { def: multilineDef("Huge", 200), methods: [] } }); // ~5000+ raw chars
  const budget = 1200;
  const block = render(["Huge"], g, budget);
  assert.ok(block, "the oversized def renders (truncated), not undefined");
  assert.ok(block.length <= budget, `within budget: ${block.length} <= ${budget}`);
  assert.match(block, /struct Huge \{/, "the def header rendered");
  assert.match(block, /field_Huge_0/, "at least the first field rendered (def is no longer dark)");
  const m = block.match(/\.\.\. (\d+) more fields/);
  assert.ok(m, "a truncation marker is present");
  const shown = [...block.matchAll(/field_Huge_\d+/g)].length;
  assert.strictEqual(Number(m[1]), 200 - shown, "marker N == fields dropped");
  assert.strictEqual(countChar(block, "{"), countChar(block, "}"), "brace-balanced");
});

// ===========================================================================
// The 0-fields-fit budget corner (invisible to INV-budget, which always had >=1
// field fit): when methods consume the budget, the def either renders a fieldless
// shell (header + `... K more fields` + close) OR is skipped — but the block NEVER
// overruns and NEVER emits an unclosed brace. This is the ShardMemCache regime.
// ===========================================================================

test("0 fields fit: a method-heavy type never overruns and never ships an unclosed brace", () => {
  // Long method sigs that eat most of the budget; a 25-field def follows.
  const methods = Array.from({ length: 40 }, (_, i) =>
    `fn very_long_method_name_number_${i}(&mut self, a: SomeKey, b: SomeOtherKey, c: u64) -> Result<u64>`);
  const g = graph({ Cache: { def: multilineDef("Cache", 25), methods } });
  for (const budget of [200, 400, 800, 1200, 1600]) {
    const block = render(["Cache"], g, budget);
    if (block === undefined) continue;
    assert.ok(block.length <= budget, `[budget=${budget}] no overrun: ${block.length} <= ${budget}`);
    assert.strictEqual(countChar(block, "{"), countChar(block, "}"), `[budget=${budget}] brace-balanced`);
    // If a def header rendered, its close must too (no header without close).
    if (block.includes("struct Cache {")) {
      assert.ok(block.includes("\n}") || /\}\n/.test(block) || block.trim().endsWith("}") || block.includes("// }"),
        `[budget=${budget}] a rendered def header has a matching close`);
    }
  }
});

// ===========================================================================
// Exact marker accounting on a partial (kept >= 1): N == fields dropped, close
// follows, all within budget. Parameterized over budgets that force a partial.
// ===========================================================================

test("partial def: marker N equals fields dropped at every partial-forcing budget", () => {
  const K = 30;
  const g = graph({ Rec: { def: multilineDef("Rec", K), methods: [] } });
  const whole = render(["Rec"], g, 100000);
  for (const frac of [0.4, 0.5, 0.6, 0.7, 0.8]) {
    const budget = Math.floor(whole.length * frac);
    const block = render(["Rec"], g, budget);
    if (block === undefined) continue;
    assert.ok(block.length <= budget, `[frac=${frac}] within budget`);
    const m = block.match(/\.\.\. (\d+) more fields/);
    const shown = [...block.matchAll(/field_Rec_\d+/g)].length;
    if (shown < K) {
      assert.ok(m, `[frac=${frac}] a partial carries a marker`);
      assert.strictEqual(Number(m[1]), K - shown, `[frac=${frac}] N=${m[1]} == dropped=${K - shown}`);
    }
    assert.strictEqual(countChar(block, "{"), countChar(block, "}"), `[frac=${frac}] balanced`);
  }
});

// ===========================================================================
// Nested defs: a root whose field edges reach local types emits those nested defs
// (via the walk), each in the DEFS-LAST phase, each brace-safe. Methods stay first.
// ===========================================================================

test("nested defs: a root's reachable nested type defs all render in the defs-last phase, methods first", () => {
  const g = graph({
    Root: {
      def: "struct Root {\n    child: Child,\n}",
      fields: [{ name: "child", typeName: "Child", isLocal: true }],
      methods: ["fn root_method(&self) -> u32"],
    },
    Child: { def: "struct Child {\n    x: u32,\n}", fields: [], methods: [] },
  });
  const block = render(["Root"], g, 100000);
  assert.ok(block, "renders");
  const methodIdx = block.indexOf("root_method");
  const rootDefIdx = block.indexOf("struct Root");
  const childDefIdx = block.indexOf("struct Child");
  assert.ok(methodIdx >= 0 && rootDefIdx >= 0 && childDefIdx >= 0, "method, root def, nested child def all present");
  assert.ok(methodIdx < rootDefIdx && methodIdx < childDefIdx, "the method precedes both defs (methods first)");
  assert.strictEqual(countChar(block, "{"), countChar(block, "}"), "brace-balanced across both defs");
});

// ===========================================================================
// Non-brace / degenerate def shapes fall back to ATOMIC (whole or skipped), never
// a spurious truncation. A `};`-terminated or single-line def is not brace-split.
// ===========================================================================

test("non-brace def shapes are atomic: single-line, and a `};`-terminated def are emitted whole or skipped, never partial", () => {
  for (const def of ["class Foo", "type T = { a: number };", "enum E { A, B }"]) {
    const g = graph({ X: { def, methods: [] } });
    const big = render(["X"], g, 100000);
    assert.ok(big, `${JSON.stringify(def)} renders whole at a big budget`);
    assert.ok(!/\.\.\. \d+ more fields/.test(big), `${JSON.stringify(def)} is atomic (no field marker)`);
    // At a budget below its size it is skipped (undefined here, only one root), never partial.
    const tiny = render(["X"], g, renderedLenApprox(def) - 1);
    assert.ok(tiny === undefined || !/\.\.\. \d+ more fields/.test(tiny), `${JSON.stringify(def)} never emits a partial`);
  }
});
function renderedLenApprox(def) {
  // header(HEADER) + def + terminator, roughly — enough to force the skip branch.
  return HEADER.length + 4 + def.length + TERMINATOR.length;
}

// ===========================================================================
// Degrade: no methods and only a def that cannot fit => undefined (no header+terminator stub).
// ===========================================================================

test("degrade: a lone oversized single-line def that cannot fit => undefined, never a header+terminator stub", () => {
  const g = graph({ Foo: { def: "class " + "F".repeat(500), methods: [] } });
  const block = render(["Foo"], g, 60);
  assert.strictEqual(block, undefined, "no content fits => undefined");
});

// ===========================================================================
// Adversarial review F1 (BLOCKER, reproduced): a def with NESTED interior braces
// across lines (Rust enum struct-variant / TS interface inline object field) must
// NEVER truncate mid-nesting into an unclosed brace. Truncation cuts only at whole
// depth-0 field units, so the block is brace-balanced at EVERY budget.
// ===========================================================================

test("F1: a nested-interior brace def (enum struct-variant) stays brace-balanced at every budget (no unclosed brace)", () => {
  const def =
    "enum Shape {\n" +
    "    Circle {\n        radius: f64,\n        center: Point,\n    },\n" +
    "    Square { side: f64 },\n" +
    "    Triangle,\n}";
  const g = graph({ Shape: { def, methods: [] } });
  for (let budget = 20; budget <= 400; budget += 3) {
    const block = render(["Shape"], g, budget);
    if (block === undefined) continue;
    assert.ok(block.length <= budget, `[budget=${budget}] within budget`);
    assert.strictEqual(
      countChar(block, "{"),
      countChar(block, "}"),
      `[budget=${budget}] brace-balanced (never cut inside a variant); block:\n${block}`,
    );
  }
});

test("F1: a TS-style interface with a nested inline object-type field stays brace-balanced when truncated", () => {
  const def =
    "interface Config {\n" +
    "    name: string;\n" +
    "    server: {\n        host: string;\n        port: number;\n    };\n" +
    "    retries: number;\n}";
  const g = graph({ Config: { def, methods: [] } });
  const whole = render(["Config"], g, 100000);
  for (const frac of [0.3, 0.45, 0.6, 0.75, 0.9]) {
    const block = render(["Config"], g, Math.floor(whole.length * frac));
    if (block === undefined) continue;
    assert.strictEqual(countChar(block, "{"), countChar(block, "}"), `[frac=${frac}] brace-balanced; block:\n${block}`);
    // the nested `server` field, if shown, is shown WHOLE (its inner braces closed)
    if (block.includes("server: {")) {
      assert.match(block, /host: string/, "a shown nested field carries its inner content");
    }
  }
});

// ===========================================================================
// Adversarial review F2 (REAL, reproduced): a def whose HEADER wraps across lines
// (rust-analyzer generic/where header, `{` on a later line) must still truncate
// brace-safe and contribute fields — NOT be misclassified non-brace and dropped
// whole (the "def goes dark" regime this session kills).
// ===========================================================================

test("F2: a wrapped-header generic def (where-clause, `{` on a later line) truncates and shows fields, not dark", () => {
  const fields = Array.from({ length: 20 }, (_, i) => `    field_${i}: Entry,`);
  const def = "struct Cache<K, V>\nwhere\n    K: Hash + Eq,\n{\n" + fields.join("\n") + "\n}";
  const g = graph({ Cache: { def, methods: [] } });
  const whole = render(["Cache"], g, 100000);
  const budget = Math.floor(whole.length * 0.5);
  const block = render(["Cache"], g, budget);
  assert.ok(block, "the oversized wrapped-header def renders (truncated), not undefined/dark");
  assert.ok(block.length <= budget, "within budget");
  assert.match(block, /struct Cache<K, V>/, "the wrapped header rendered");
  assert.match(block, /where/, "the where-clause header line rendered");
  assert.match(block, /field_0/, "at least the first field rendered (def is NOT dark)");
  assert.match(block, /\.\.\. \d+ more fields/, "a truncation marker is present");
  assert.strictEqual(countChar(block, "{"), countChar(block, "}"), "brace-balanced");
});

// Direct unit tests of the exported brace parser (belt-and-suspenders on the splitter).
test("parseBraceDef: flat fields, wrapped header, nested unit, and non-brace fallbacks", () => {
  const { parseBraceDef } = mod;
  // flat
  const flat = parseBraceDef(["struct T {", "    a: u32,", "    b: u32,", "}"]);
  assert.deepStrictEqual(flat.header, ["struct T {"]);
  assert.strictEqual(flat.units.length, 2);
  assert.deepStrictEqual(flat.close, ["}"]);
  // wrapped header
  const wrapped = parseBraceDef(["struct C<K>", "where", "    K: Eq,", "{", "    a: u32,", "}"]);
  assert.deepStrictEqual(wrapped.header, ["struct C<K>", "where", "    K: Eq,", "{"]);
  assert.strictEqual(wrapped.units.length, 1);
  // nested variant is ONE unit
  const nested = parseBraceDef(["enum E {", "    V {", "        x: u32,", "    },", "    W,", "}"]);
  assert.strictEqual(nested.units.length, 2, "V{...} is one unit, W is another");
  // fallbacks => undefined (atomic)
  assert.strictEqual(parseBraceDef(["class Foo"]), undefined, "single line");
  assert.strictEqual(parseBraceDef(["struct X {", "}"]), undefined, "no body (len<3)");
  assert.strictEqual(parseBraceDef(["struct X {", "    a: u32,"]), undefined, "unbalanced (no close)");
  assert.strictEqual(parseBraceDef(["a }", "b {", "c"]), undefined, "close precedes open");
});
