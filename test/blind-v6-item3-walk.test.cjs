// BLIND ORACLE - v6 P4 item 3: the recursive data-shape walk + THE SHIP GATE.
//
// Black-box contract test for the PURE bounded walk against SURFACE-p4-item3.md
// (G1 ship gate + P1-P3) and investigation-item3.md. Written WITHOUT reading any
// implementation body - only the surface spec and the item2b / impl9 patterns for
// headless bundling.
//
// The walk is a PURE core function so the ship gate is fast + deterministic (no
// live rust-analyzer). Proposed export (the implementer creates it - a require-red
// is the acceptable initial state):
//
//   walkDataShape(rootTypeName, resolveStruct, bounds)
//     -> { block: string, dropped: string[] }
//
//   resolveStruct(typeName) -> { def, fields } | undefined   (the INJECTED edge
//     resolver; this test feeds a FAKE struct graph as a Map). Each field is
//     { name, typeName, isLocal }.  `def` is the emitted struct-def text.
//   bounds = { D_MAX, B_MAX, N_MAX, TOK_MAX }.
//
// Robustness: every fake struct's `def` carries a unique sentinel
// `<<STRUCTDEF Name>>`, so "which defs were emitted" is read straight out of the
// assembled `block` regardless of how the implementer joins/renders them - the
// asserts never assume the block's exact shape, only which struct defs it carries.
//
// TOKEN PROXY (stated): I3 is asserted as `block.length <= TOK_MAX * 4` (the
// chars/4 proxy the spec names in I3). See report for the ambiguity note.
//
// Run: SKIP_LIVE=1 node --test test/blind-v6-item3-walk.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- Bundle the pure core module (no vscode needed, but the alias is harmless
// and mirrors the sibling oracles). RED-by-require lives here: if
// src/core/dataShape.ts / walkDataShape does not exist, this throws and every
// test below errors - the acceptable red state noted in the header.
const STUB = path.join(__dirname, ".blind-v6-item3-walk-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = { languages: {}, window: {}, workspace: {} };\n`,
);
const entry = path.join(__dirname, ".blind-v6-item3-walk.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item3-walk.bundle.cjs");
fs.writeFileSync(entry, `export { walkDataShape } from "../src/core/dataShape";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { walkDataShape } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// ---- The real bounds (SURFACE-p4-item3.md THE 2-D BOUND).
const BOUNDS = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 };

// ---- Fake-graph helpers. Each struct def carries a unique sentinel so the
// emitted set is readable from the block, plus enough body bytes to make the
// token/count caps bite on a pathological graph. A field is { name, typeName,
// isLocal }; isLocal=false marks a std/primitive/external type (never emitted).
const defOf = (name, body) => `<<STRUCTDEF ${name}>> pub struct ${name} { ${body} }`;
const local = (name, fieldName) => ({ name: fieldName, typeName: name, isLocal: true });
const prim = (fieldName, typeName) => ({ name: fieldName, typeName, isLocal: false });
// A struct node from its local children + optional primitive fields.
const node = (name, localChildren = [], prims = []) => {
  const fields = [
    ...localChildren.map((c, i) => local(c, `f_${c.toLowerCase()}_${i}`)),
    ...prims,
  ];
  const body = fields.map((f) => `${f.name}: ${f.typeName}`).join(", ");
  return { def: defOf(name, body), fields };
};

// Read the emitted struct-def names straight out of the assembled block.
const emittedNames = (block) => [...(block || "").matchAll(/<<STRUCTDEF (\w+)>>/g)].map((m) => m[1]);
// Normalise the return (accept the proposed shape, tolerate a couple of aliases).
const norm = (r) => ({ block: (r && (r.block ?? r.text)) || "", dropped: (r && (r.dropped ?? r.droppedTypes)) || [] });

// A resolveStruct backed by a Map, recording which type names it was asked about.
function graphResolver(map) {
  const asked = [];
  const resolveStruct = (typeName) => {
    asked.push(typeName);
    return map.get(typeName);
  };
  return { resolveStruct, asked };
}

// ===========================================================================
// THE ADVERSARIAL GRAPH (the trust-critical artifact). One Map that is
// SIMULTANEOUSLY wide, deep, cyclic, and diamond-shaped:
//   WIDE : `Wide` has 20 distinct local field-types W0..W19, each of which in
//          turn has 4 local grandchildren G0..G3 (so depth+breadth alone would
//          allow 1 + 4 + 16 = 21 defs; N_MAX=6 must dominate). Wide also has a
//          primitive `name: String` (I5 probe: emitted node, primitive field).
//   DEEP : a 10-long chain A->B->C->...->J, one local field per hop. From root A
//          only A,B,C are within D_MAX=2; D..J must NEVER be emitted (I1).
//   CYCLIC: Cyc1->Cyc2->Cyc1 (a 2-cycle) - each emitted at most once (I4).
//   DIAMOND: Dia->L, Dia->R, L->Bot, R->Bot - Bot reached two ways, emitted once.
// ===========================================================================
function adversarialGraph() {
  const map = new Map();

  // WIDE + grandchildren. Grandchildren are leaves carrying a primitive (I5 at
  // depth 2 too). Each Wi points at all four grandchildren, so from Wide the
  // depth-2 frontier is large and N_MAX must bind.
  const grandkids = ["G0", "G1", "G2", "G3"];
  for (const g of grandkids) map.set(g, node(g, [], [prim("count", "u32")]));
  const wides = Array.from({ length: 20 }, (_, i) => `W${i}`);
  for (const w of wides) map.set(w, node(w, grandkids, [prim("tag", "String")]));
  map.set("Wide", node("Wide", wides, [prim("name", "String")]));

  // DEEP chain A..J (10 nodes). Each links to the next; J is a leaf primitive.
  const chain = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  for (let i = 0; i < chain.length; i++) {
    const next = chain[i + 1];
    map.set(chain[i], next ? node(chain[i], [next]) : node(chain[i], [], [prim("leaf", "u32")]));
  }

  // CYCLIC 2-cycle.
  map.set("Cyc1", node("Cyc1", ["Cyc2"]));
  map.set("Cyc2", node("Cyc2", ["Cyc1"]));

  // DIAMOND.
  map.set("Dia", node("Dia", ["L", "R"]));
  map.set("L", node("L", ["Bot"]));
  map.set("R", node("R", ["Bot"]));
  map.set("Bot", node("Bot", [], [prim("done", "u32")]));

  return map;
}

// Types within graph distance <= D from `root` in the given Map (for I1: nothing
// deeper than D_MAX may be emitted). BFS over the LOCAL edges only.
function reachableWithin(map, root, D) {
  const seen = new Set([root]);
  let frontier = [root];
  for (let d = 0; d < D; d++) {
    const next = [];
    for (const t of frontier) {
      const s = map.get(t);
      if (!s) continue;
      for (const f of s.fields) {
        if (f.isLocal && map.has(f.typeName) && !seen.has(f.typeName)) {
          seen.add(f.typeName);
          next.push(f.typeName);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// G1 - THE SHIP GATE. Run the walk from every adversarial root and assert EACH
// invariant I1-I6. If a naive unbounded DFS could pass this, it is not strong
// enough - so I1 is asserted against the true within-D_MAX reachable set, I2 is
// the hard <=N_MAX cap on every root, and I4 pins each cyclic member to <=1.
// ---------------------------------------------------------------------------
test("G1 ship gate: the walk is bound-proven on a wide+deep+cyclic+diamond graph (I1-I6)", () => {
  const map = adversarialGraph();
  const roots = ["Wide", "A", "Cyc1", "Dia"];

  for (const root of roots) {
    const { resolveStruct } = graphResolver(map);
    // I4 (termination): a hang fails the test by never returning. A synchronous
    // return here IS the termination proof for the pure walk.
    const { block, dropped } = norm(walkDataShape(root, resolveStruct, BOUNDS));
    const names = emittedNames(block);
    const allowed = reachableWithin(map, root, BOUNDS.D_MAX);

    // I2 - hard total cap holds for EVERY root regardless of width/depth.
    assert.ok(
      names.length <= BOUNDS.N_MAX,
      `I2[${root}]: emitted ${names.length} struct defs > N_MAX=${BOUNDS.N_MAX} (${names.join(",")})`,
    );

    // I1 - no emitted def is past graph distance D_MAX from the root.
    for (const n of names) {
      assert.ok(
        allowed.has(n),
        `I1[${root}]: emitted \`${n}\` which is past D_MAX=${BOUNDS.D_MAX} (allowed: ${[...allowed].join(",")})`,
      );
    }

    // I3 - token budget (chars/4 proxy): block <= TOK_MAX*4 chars.
    assert.ok(
      block.length <= BOUNDS.TOK_MAX * 4,
      `I3[${root}]: block ${block.length} chars > TOK_MAX*4=${BOUNDS.TOK_MAX * 4}`,
    );

    // I4 - visited-set: each type appears at most once (no cycle re-emit, no
    // diamond double-emit). Asserted on every root, and the cyclic/diamond roots
    // are the discriminating ones.
    assert.strictEqual(
      new Set(names).size,
      names.length,
      `I4[${root}]: a type is emitted more than once (${names.join(",")})`,
    );

    // I5 - std/primitive field types are never emitted as struct defs. `String`
    // and `u32` appear as field-type strings on emitted nodes, but never as defs.
    assert.ok(!names.includes("String"), `I5[${root}]: primitive String emitted as a def`);
    assert.ok(!names.includes("u32"), `I5[${root}]: primitive u32 emitted as a def`);
    assert.ok(!block.includes("<<STRUCTDEF String>>"), `I5[${root}]: a String struct def was emitted`);
  }

  // I4 (cyclic/diamond specifics): the 2-cycle emits Cyc1 and Cyc2 once each and
  // terminates; the diamond emits Bot once though reached two ways.
  {
    const { resolveStruct } = graphResolver(map);
    const cyc = emittedNames(norm(walkDataShape("Cyc1", resolveStruct, BOUNDS)).block);
    assert.strictEqual(cyc.filter((n) => n === "Cyc1").length, 1, "I4: Cyc1 emitted exactly once");
    assert.strictEqual(cyc.filter((n) => n === "Cyc2").length, 1, "I4: Cyc2 emitted exactly once");
  }
  {
    const { resolveStruct } = graphResolver(map);
    const dia = emittedNames(norm(walkDataShape("Dia", resolveStruct, BOUNDS)).block);
    assert.strictEqual(dia.filter((n) => n === "Bot").length, 1, "I4: diamond Bot emitted exactly once");
  }

  // I1 (deep specific): from A, NONE of D..J may appear - depth-only bounding
  // would leak them; the D_MAX guard must not.
  {
    const { resolveStruct } = graphResolver(map);
    const deep = emittedNames(norm(walkDataShape("A", resolveStruct, BOUNDS)).block);
    for (const t of ["D", "E", "F", "G", "H", "I", "J"]) {
      assert.ok(!deep.includes(t), `I1: deep type \`${t}\` (distance > D_MAX) was emitted`);
    }
  }

  // I6 - a cap that truncates signals a drop. On the Wide root both B_MAX (20
  // fields walked <=4) and N_MAX (21 reachable capped to 6) truncate, so a drop
  // MUST be reported - no silent truncation.
  {
    const { resolveStruct } = graphResolver(map);
    const { block, dropped } = norm(walkDataShape("Wide", resolveStruct, BOUNDS));
    assert.ok(emittedNames(block).length <= BOUNDS.N_MAX, "I6 setup: Wide is capped");
    assert.ok(
      Array.isArray(dropped) && dropped.length >= 1,
      `I6: a cap truncated the Wide walk but nothing was reported as dropped (${JSON.stringify(dropped)})`,
    );
  }
});

// ---------------------------------------------------------------------------
// P1 - depth-2 reach. Order{customer:Customer}, Customer{address:Address},
// Address{city:String}. The walk from Order emits Order's, Customer's, AND
// Address's defs (the pillar case; item-2b depth-1 would miss Address).
// ---------------------------------------------------------------------------
test("P1: depth-2 walk reaches Order -> Customer -> Address", () => {
  const map = new Map([
    ["Order", node("Order", ["Customer"], [prim("id", "u64")])],
    ["Customer", node("Customer", ["Address"], [prim("name", "String")])],
    ["Address", node("Address", [], [prim("city", "String")])],
  ]);
  const { resolveStruct } = graphResolver(map);
  const { block } = norm(walkDataShape("Order", resolveStruct, BOUNDS));
  const names = emittedNames(block);
  assert.ok(names.includes("Order"), `Order's def emitted; got ${names.join(",")}`);
  assert.ok(names.includes("Customer"), `Customer's def emitted (depth 1); got ${names.join(",")}`);
  assert.ok(names.includes("Address"), `Address's def emitted (depth 2 - the reach item-2b misses); got ${names.join(",")}`);
});

// ---------------------------------------------------------------------------
// P2 - locality. A local field (customer: Customer, isLocal true) recurses; a
// std field (name: String, isLocal false) does NOT emit a String def, and the
// resolver is never even asked to resolve a String into a struct.
// ---------------------------------------------------------------------------
test("P2: local field recurses, a std field emits no def", () => {
  const map = new Map([
    ["Order", { def: defOf("Order", "id: u64, customer: Customer, name: String"), fields: [
      prim("id", "u64"),
      local("Customer", "customer"),
      prim("name", "String"),
    ] }],
    ["Customer", node("Customer", [], [prim("name", "String")])],
  ]);
  const { resolveStruct, asked } = graphResolver(map);
  const { block } = norm(walkDataShape("Order", resolveStruct, BOUNDS));
  const names = emittedNames(block);
  assert.ok(names.includes("Customer"), "the local field type Customer is walked and emitted");
  assert.ok(!names.includes("String"), "the std field type String is NOT emitted as a def");
  assert.ok(!block.includes("<<STRUCTDEF String>>"), "no String struct def anywhere in the block");
  assert.ok(!asked.includes("String"), "the resolver is not asked to resolve a std field type into a struct");
});

// ---------------------------------------------------------------------------
// P3 - budget + drop log. A graph exceeding N_MAX total defs => the block is
// capped at <=N_MAX and `dropped` names the omitted types (which are NOT emitted).
// ---------------------------------------------------------------------------
test("P3: a graph exceeding N_MAX is capped and the dropped types are named", () => {
  // A bushy graph: Root -> T0..T3 (4 local children), each Ti -> C0..C3 (shared
  // grandchildren). 1 + 4 + 4 = 9 reachable within depth 2 > N_MAX=6.
  const map = new Map();
  const kids = ["C0", "C1", "C2", "C3"];
  for (const c of kids) map.set(c, node(c, [], [prim("n", "u32")]));
  const ts = ["T0", "T1", "T2", "T3"];
  for (const t of ts) map.set(t, node(t, kids));
  map.set("Root", node("Root", ts));

  const { resolveStruct } = graphResolver(map);
  const { block, dropped } = norm(walkDataShape("Root", resolveStruct, BOUNDS));
  const names = emittedNames(block);

  assert.ok(names.length <= BOUNDS.N_MAX, `block capped at <=N_MAX; emitted ${names.length} (${names.join(",")})`);
  assert.ok(Array.isArray(dropped) && dropped.length >= 1, `dropped names the omitted types; got ${JSON.stringify(dropped)}`);
  // Every dropped name is a real graph type that did NOT make it into the block.
  for (const d of dropped) {
    assert.ok(!names.includes(d), `dropped type \`${d}\` must not also be emitted`);
  }
});

// ---------------------------------------------------------------------------
// P4 - THE PER-PROMPT BOUND (shared state). A prefill runs up to 4 INDEPENDENT
// walks (one per kept local type) into ONE prompt. Per-walk bounds alone leave
// the PER-PROMPT total unbounded (~4xTOK_MAX) and re-emit a shared nested type.
// walkDataShape takes an optional shared state { visited, remainingChars } the
// caller threads across the walks: a type emitted by one walk is not re-emitted
// by another, and one aggregate token budget spans all walks. This is the bound
// the scout's self-inflation concern is actually about.
// ---------------------------------------------------------------------------
test("P4: sibling walks share a visited-set + an aggregate budget (per-prompt bound)", () => {
  // Alpha and Beta both nest the SAME type Shared.
  const map = new Map([
    ["Alpha", node("Alpha", ["Shared"], [prim("a", "u32")])],
    ["Beta", node("Beta", ["Shared"], [prim("b", "u32")])],
    ["Shared", node("Shared", [], [prim("s", "u32")])],
  ]);

  const AGG_TOK = 300;
  const shared = { visited: new Set(), remainingChars: AGG_TOK * 4 };
  const { resolveStruct } = graphResolver(map);
  const wA = norm(walkDataShape("Alpha", resolveStruct, BOUNDS, shared));
  const wB = norm(walkDataShape("Beta", resolveStruct, BOUNDS, shared));
  const combined = [wA.block, wB.block].filter((b) => b.length > 0).join("\n\n");
  const names = emittedNames(combined);

  // Cross-walk dedup: the shared nested type is emitted ONCE across BOTH walks.
  assert.strictEqual(
    names.filter((n) => n === "Shared").length,
    1,
    `Shared emitted once across the two walks (got ${names.join(",")})`,
  );
  assert.ok(names.includes("Alpha") && names.includes("Beta"), `both roots present (got ${names.join(",")})`);
  // The PER-PROMPT total is within the aggregate budget, not 2xTOK_MAX.
  assert.ok(combined.length <= AGG_TOK * 4, `combined ${combined.length} chars > aggregate ${AGG_TOK * 4}`);

  // The aggregate BINDS: a tiny budget with room for ~one def forces the later
  // walk to drop (logged), and the combined block stays inside the tiny budget.
  const tinyBudget = map.get("Alpha").def.length + 3;
  const tight = { visited: new Set(), remainingChars: tinyBudget };
  const g2 = graphResolver(map);
  const tA = norm(walkDataShape("Alpha", g2.resolveStruct, BOUNDS, tight));
  const tB = norm(walkDataShape("Beta", g2.resolveStruct, BOUNDS, tight));
  const tCombined = [tA.block, tB.block].filter((b) => b.length > 0).join("\n\n");
  assert.ok(tCombined.length <= tinyBudget, `tiny-budget combined ${tCombined.length} > budget ${tinyBudget}`);
  assert.ok(
    tA.dropped.length + tB.dropped.length >= 1,
    `budget exhaustion is reported as a drop (got A=${JSON.stringify(tA.dropped)} B=${JSON.stringify(tB.dropped)})`,
  );
});
