// BLIND ORACLE - v40: render-time budget truncation for the data-shape walk.
//
// Contract under test (paraphrased from the driving goal): today walkDataShape
// (src/core/dataShape.ts) drops a struct/enum def WHOLE when emitting it would
// breach the per-walk TOK_MAX char budget or the shared cross-walk aggregate
// budget (SharedWalkState.remainingChars) - a breaching type renders NOTHING,
// not even its own name. The fix makes a breaching def TRUNCATE at render time
// instead: brace-safe, unit-by-unit (never cutting inside a nested brace, never
// leaving an unclosed `{`), emitting as many complete field units as fit, then a
// marker line of the exact form `... N more fields` (N = dropped field count),
// then the closing brace. A def within budget still renders in FULL, byte
// identical, no marker. The overall bound is still honored - truncation is HOW
// it is honored now, instead of a whole-type drop.
//
// Reference (read, not tested directly): src/core/fimWholeBlock.ts
// `parseBraceDef` (pure unit-splitter; a def undefined-for is emitted ATOMICALLY
// - whole or entirely absent, never partially truncated) and the closure
// `emitDef` inside `renderWholeBlockInjection` (the brace-safe truncation
// algorithm shape: header, kept units, `${indent}... N more fields` marker,
// close; reserve the worst-case marker+close so a def that does not fit even
// as a bare shell is skipped whole rather than left unclosed).
//
// STRUCTURAL ASSUMPTION (see note on test 6 below and inline comments): the fix
// lands in walkDataShape (src/core/dataShape.ts) and its two vscode-layer
// callers shapeBlock/tsShapeBlock (src/vscode/fnGen.ts). Nothing in fnGen.ts is
// exported at a level a black-box test can drive without reading its internals
// (out of bounds for this file), so every test here drives walkDataShape
// directly - the one exported, documented entry point on the CURRENT surface
// whose types (WalkBounds, WalkResult, SharedWalkState) already describe this
// exact budget. This mirrors the existing blind-v6-item3-walk.test.cjs P4
// pattern for the shared-budget case. If the implementer's fix instead moves
// the truncation to a NEW render-layer function that walkDataShape's callers
// invoke (rather than truncating inside walkDataShape itself), the SETUP below
// (which function is called, with what arguments) may need to change to call
// that function instead - the ASSERTIONS (marker format, brace balance, full-
// vs-truncated-vs-absent) must not change, since those come from the contract
// paragraph above, not from this structural guess.
//
// Root-eligibility note: every oversized def below is walked as the WALK'S OWN
// ROOT (a single-node graph, no parent). This is deliberate: exempting the root
// from the byte cap was tried in session-v39 and explicitly REFUTED on the
// corpus (see the comment at src/core/dataShape.ts ~115-119) - a root-level
// oversized type must be as eligible for truncation as any nested type. These
// tests would catch a regression back to that refuted exemption.
//
// Run: SKIP_LIVE=1 node --test test/blind-v40-render-budget.test.cjs
// Expected at write time: RED on the truncation-specific tests (today's
// walkDataShape drops the whole def on breach, so no header/marker survives);
// GREEN on the within-budget full-render test (today's un-truncated path is
// unchanged by this contract).

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore, sleep } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v40-render-budget",
  `export { walkDataShape } from "../src/core/dataShape";\n`,
);
const { walkDataShape } = mod;
test.after(cleanup);

// ---------------------------------------------------------------------------
// Synthetic def builders. Every field line is FLAT (no nested brace) unless
// noted, so each field line is exactly one parseBraceDef "unit" - the simplest
// case the unit-splitting semantics describe ("a flat `name: T,` is one unit").
// ---------------------------------------------------------------------------

const NAME = "BigStruct";
const headerLine = (name) => `struct ${name} {`;
const CLOSE_LINE = "}";
const fieldLine = (i) => `    field_${i}: u64,`;

// A flat N-field struct def, multi-line, brace-balanced - the shape
// parseBraceDef splits cleanly (header opens exactly one net brace, body
// partitions into whole depth-0 units, close is the final line).
function buildFlatDef(name, numFields) {
  const lines = [headerLine(name)];
  for (let i = 0; i < numFields; i++) {
    lines.push(fieldLine(i));
  }
  lines.push(CLOSE_LINE);
  return lines.join("\n");
}

// A def with ONE nested multi-line unit (its own inner `{`/`}` pair) among
// flat fields, so a truncation test can prove a cut never lands INSIDE that
// nested brace - only ever between whole units.
function buildNestedDef(name) {
  const lines = [
    headerLine(name),
    fieldLine(0),
    "    inner: Nested {",
    "        p: u64,",
    "        q: u64,",
    "    },",
    fieldLine(1),
    fieldLine(2),
    fieldLine(3),
    CLOSE_LINE,
  ];
  return lines.join("\n");
}

// A resolver over a single-entry Map: `name` resolves to `def` with no local
// fields (a leaf), so the walk that reaches it as ROOT emits (or truncates,
// or skips) exactly that one def and nothing else.
function singleTypeResolver(name, def) {
  return (typeName) => (typeName === name ? { def, fields: [] } : undefined);
}

// Generous 2-D structural bounds (D_MAX/B_MAX/N_MAX never bind in these
// single-node graphs); only TOK_MAX (and, in test 6, the shared aggregate) is
// under test.
const GEN_BOUNDS = { D_MAX: 3, B_MAX: 6, N_MAX: 8 };

// Count '{' vs '}' occurrences in a string - the brace-balance check the task
// asks for directly ("a real balance check... count `{` vs `}`").
function braceCounts(s) {
  const open = (s.match(/\{/g) || []).length;
  const close = (s.match(/\}/g) || []).length;
  return { open, close };
}

// Pull the `... N more fields` marker's N out of a block of text, tolerant of
// leading indent (the reference's `${indent}... N more fields`) - the contract
// only pins the literal `... N more fields` phrase, not surrounding
// whitespace/indentation, which is incidental rendering, not contract.
function markerCount(text) {
  const m = /\.\.\.\s*(\d+)\s*more fields/.exec(text);
  return m ? Number(m[1]) : undefined;
}

// Count how many of this def's field lines actually made it into the output,
// by re-matching the same `field_N: u64,` pattern the def was built from -
// robust to exactly WHERE the implementer truncates, since it reads the
// ANSWER out of the output rather than predicting it.
function countKeptFieldLines(text) {
  return (text.match(/field_\d+: u64,/g) || []).length;
}

// ===========================================================================
// 1. Within-budget: full, byte-identical render, no marker.
// ===========================================================================
test("a def comfortably within budget renders in FULL, byte-identical, no marker line", () => {
  const def = buildFlatDef(NAME, 5);
  const resolveStruct = singleTypeResolver(NAME, def);
  // TOK_MAX*4 far exceeds the def's length: nothing to truncate.
  const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil((def.length * 4) / 4) };
  const result = walkDataShape(NAME, resolveStruct, bounds);

  assert.strictEqual(result.defs.length, 1, `the one reachable def is emitted; got ${JSON.stringify(result.defs)}`);
  assert.strictEqual(result.defs[0].name, NAME);
  assert.strictEqual(result.defs[0].def, def, "an in-budget def is byte-identical to its source form");
  assert.strictEqual(result.block, def, "the sole walk's block is exactly the untruncated def");
  assert.strictEqual(markerCount(result.block), undefined, "no marker line on an in-budget def");
});

// ===========================================================================
// 2. Breach with a shell that still fits: NEVER completely absent - the header
//    line must survive at minimum.
// ===========================================================================
test("a def that breaches the budget still renders SOMETHING - at minimum its header line - never completely absent", () => {
  const def = buildFlatDef(NAME, 40); // large enough that 40 fields will not fit
  const resolveStruct = singleTypeResolver(NAME, def);
  const header = headerLine(NAME);
  // A budget with room for the header + close + a worst-case marker + a
  // handful of fields, but nowhere near the full 40-field def.
  const shellRoom = header.length + CLOSE_LINE.length + `... 40 more fields`.length + 200;
  assert.ok(shellRoom < def.length, "sanity: the shell-sized budget is well short of the full def");
  const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil(shellRoom / 4) };
  const result = walkDataShape(NAME, resolveStruct, bounds);

  assert.notStrictEqual(result.block, "", "a reachable, resolvable, breaching type must not render as nothing");
  assert.ok(result.defs.length >= 1, "the type still appears in the named defs list");
  assert.ok(
    result.defs[0].def.includes(header),
    `the header line survives truncation; got ${JSON.stringify(result.defs[0].def)}`,
  );
});

// ===========================================================================
// 3. Marker format + count correctness: `... N more fields`, N positive and
//    exactly equal to the actual dropped-field count (kept + N == total).
// ===========================================================================
test("a truncated def's marker is `... N more fields` with N == actual dropped field units", () => {
  const TOTAL_FIELDS = 30;
  const def = buildFlatDef(NAME, TOTAL_FIELDS);
  const resolveStruct = singleTypeResolver(NAME, def);
  const header = headerLine(NAME);
  // Room for header + close + worst-case marker + ~10 fields' worth - forces
  // truncation (30 fields do not fit) while leaving room for some fields to
  // survive, so the marker's N is meaningfully between 1 and TOTAL_FIELDS.
  const oneField = fieldLine(0).length + 1;
  const shellRoom =
    header.length + CLOSE_LINE.length + `... ${TOTAL_FIELDS} more fields`.length + oneField * 10 + 20;
  assert.ok(shellRoom < def.length, "sanity: budget forces truncation of the 30-field def");
  const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil(shellRoom / 4) };
  const result = walkDataShape(NAME, resolveStruct, bounds);

  const text = result.block;
  const n = markerCount(text);
  assert.ok(n !== undefined, `a marker line matching "... N more fields" is present; got ${JSON.stringify(text)}`);
  assert.ok(Number.isInteger(n) && n > 0, `N is a positive integer; got ${n}`);

  const kept = countKeptFieldLines(text);
  assert.ok(kept > 0, `at least one field unit survived (this budget was sized to allow some); kept=${kept}`);
  assert.ok(kept < TOTAL_FIELDS, `not every field fit (truncation actually happened); kept=${kept}`);
  assert.strictEqual(
    kept + n,
    TOTAL_FIELDS,
    `kept (${kept}) + marker N (${n}) must equal the true total field count (${TOTAL_FIELDS})`,
  );
});

// ===========================================================================
// 4. Brace safety across a spread of budgets on the SAME oversized, nested
//    def: truncation only ever lands at a unit boundary. Includes a budget so
//    tight even the bare shell (header+marker+close) cannot fit, where the
//    whole def must be skipped rather than left partial/unclosed.
// ===========================================================================
test("brace safety: a truncated def's output is never unclosed, at any budget size, including impossibly-tight ones", () => {
  const def = buildNestedDef(NAME);
  const header = headerLine(NAME);
  const fullCounts = braceCounts(def);
  assert.strictEqual(fullCounts.open, fullCounts.close, "sanity: the source def itself is brace-balanced");
  assert.ok(fullCounts.open >= 2, "sanity: the def has a NESTED brace pair (header's + the inner unit's)");

  // A spread from "impossibly tight" (smaller than the header alone) up to
  // "generous" (fits everything), stepping through every truncation regime.
  const budgetsInChars = [1, 5, header.length - 1, header.length + 5, header.length + 40, def.length * 4];

  for (const charBudget of budgetsInChars) {
    const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil(charBudget / 4) };
    const resolveStruct = singleTypeResolver(NAME, def);
    const result = walkDataShape(NAME, resolveStruct, bounds);
    const text = result.block;

    if (text.length === 0) {
      // Nothing emitted - only acceptable when the def is not fully present;
      // for the tightest budgets this is the contractually correct outcome
      // (skip the whole def rather than leave an unclosed shell).
      continue;
    }
    const { open, close } = braceCounts(text);
    assert.strictEqual(
      open,
      close,
      `charBudget=${charBudget}: output has an unbalanced brace count (open=${open}, close=${close}); text=${JSON.stringify(text)}`,
    );
    // Never a marker-less partial: either the WHOLE def rendered (ends with
    // the def's own close line, no marker) or a marker is present naming what
    // was cut. A text that contains the header but omits the final CLOSE_LINE
    // with no marker would be exactly the unclosed-partial the contract bans.
    const hasMarker = markerCount(text) !== undefined;
    const endsWithClose = text.trimEnd().endsWith(CLOSE_LINE);
    if (text.includes(header)) {
      assert.ok(
        hasMarker || endsWithClose,
        `charBudget=${charBudget}: header present but output is neither a full close nor a marked truncation; text=${JSON.stringify(text)}`,
      );
    }
  }

  // The genuinely-impossible budget (smaller than the header line itself)
  // must skip the WHOLE def - never a truncated-but-unclosed fragment.
  {
    const tinyBounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil(1 / 4) };
    const resolveStruct = singleTypeResolver(NAME, def);
    const result = walkDataShape(NAME, resolveStruct, tinyBounds);
    assert.strictEqual(
      result.block,
      "",
      `a budget too tight even for the header must skip the whole def, not emit a fragment; got ${JSON.stringify(result.block)}`,
    );
    assert.strictEqual(result.defs.length, 0, "no def entry for a fully-skipped type");
  }
});

// ===========================================================================
// 5. Non-brace / unparseable shapes are ATOMIC: whole if it fits, else
//    entirely absent - never a partial with a marker (parseBraceDef's own doc
//    comment: undefined for anything not cleanly brace-splittable, and an
//    unparseable def is "emitted whole or skipped, never as a partial").
// ===========================================================================
test("a single-line / non-brace def is emitted ATOMICALLY - whole or entirely absent, never truncated with a marker", () => {
  const def = "type Foo = string;"; // no `{` at all: parseBraceDef returns undefined for this shape
  const name = "Foo";
  const resolveStruct = singleTypeResolver(name, def);

  // Fits: whole, byte-identical.
  {
    const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil((def.length * 4) / 4) };
    const result = walkDataShape(name, resolveStruct, bounds);
    assert.strictEqual(result.block, def, "an in-budget non-brace def renders whole, byte-identical");
    assert.strictEqual(markerCount(result.block), undefined, "no marker on a non-brace def");
  }
  // Does not fit: entirely absent, never a cut-down fragment or a marker.
  {
    const bounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil(1 / 4) };
    const result = walkDataShape(name, resolveStruct, bounds);
    assert.strictEqual(result.block, "", "a non-brace def that does not fit is dropped whole, not fragmented");
    assert.strictEqual(result.defs.length, 0, "no def entry for a dropped non-brace type");
  }
});

// ===========================================================================
// 6. The per-type budget composes with the SHARED cross-walk aggregate
//    (SharedWalkState.remainingChars): a second type walked after a first
//    that consumed most of the shared budget is truncated (or dropped if
//    truly nothing fits), never silently exceeding the aggregate.
//
// STRUCTURAL ASSUMPTION: driven directly through walkDataShape + a threaded
// SharedWalkState, the same call shape the existing P4 test in
// blind-v6-item3-walk.test.cjs uses today, and the only shared-budget entry
// point currently exported from dataShape.ts. If the fix instead needs a
// render-layer function to demonstrate cross-walk truncation, adjust the
// SETUP calls below to call that function on the same two-type scenario - the
// assertions (aggregate never exceeded; second type's def is non-absent
// where the aggregate leaves it any shell room) should not need to change.
// ===========================================================================
test("a second type's def composes with the shared cross-walk budget: truncated/dropped, aggregate never exceeded", () => {
  const FIRST = "Alpha";
  const SECOND = "Beta";
  const firstDef = buildFlatDef(FIRST, 20);
  const secondDef = buildFlatDef(SECOND, 20);
  const secondHeader = headerLine(SECOND);

  const map = new Map([
    [FIRST, { def: firstDef, fields: [] }],
    [SECOND, { def: secondDef, fields: [] }],
  ]);
  const resolveStruct = (typeName) => map.get(typeName);

  // A per-walk TOK_MAX generous enough that TOK_MAX alone never binds; only
  // the shared aggregate is under test.
  const roomyBounds = { ...GEN_BOUNDS, TOK_MAX: Math.ceil((Math.max(firstDef.length, secondDef.length) * 4) / 4) };

  // Aggregate sized for the FULL first def plus a shell (header + worst-case
  // marker + close + a few fields) of the second - not both in full.
  const secondShellRoom =
    secondHeader.length + CLOSE_LINE.length + `... 20 more fields`.length + (fieldLine(0).length + 1) * 5 + 20;
  const aggregate = firstDef.length + secondShellRoom;
  assert.ok(
    aggregate < firstDef.length + secondDef.length,
    "sanity: the aggregate is short of what both full defs would need",
  );

  const shared = { visited: new Set(), remainingChars: aggregate };
  const wAlpha = walkDataShape(FIRST, resolveStruct, roomyBounds, shared);
  const wBeta = walkDataShape(SECOND, resolveStruct, roomyBounds, shared);

  assert.strictEqual(wAlpha.block, firstDef, "the first walk, unconstrained by the tight per-walk cap, renders in full");

  // The combined rendered output (however the caller joins per-walk blocks)
  // must never exceed the aggregate budget it was given - the bound is still
  // honored overall, truncation is just how now.
  const combinedLen = wAlpha.block.length + wBeta.block.length;
  assert.ok(
    combinedLen <= aggregate + 4, // +SEP-scale slack: exact join-separator accounting is a caller concern, not this contract
    `combined output (${combinedLen} chars) must not silently exceed the shared aggregate (${aggregate}); alpha=${wAlpha.block.length} beta=${wBeta.block.length}`,
  );

  // Beta was DELIBERATELY sized a real shell's worth of remaining aggregate
  // room (header + worst-case marker + close + 5 fields, see secondShellRoom
  // above) - this is the "shell fits" case from test 2, replayed across the
  // shared budget instead of the per-walk one. It must not vanish completely;
  // an unconditional assert here (not gated on "if truncated") is what makes
  // this test RED against today's whole-drop shared-budget path and GREEN
  // only once the second walk truncates instead of dropping.
  assert.notStrictEqual(
    wBeta.block,
    "",
    `Beta had room for a shell under the shared aggregate; must not render as nothing; alpha consumed ${wAlpha.block.length}/${aggregate}`,
  );
  assert.ok(
    wBeta.block.includes(secondHeader) || wBeta.block === secondDef,
    `Beta's header survives when any of its shared-budget share remains; got ${JSON.stringify(wBeta.block)}`,
  );
  const { open, close } = braceCounts(wBeta.block);
  assert.strictEqual(open, close, `Beta's truncated output must stay brace-balanced; got ${JSON.stringify(wBeta.block)}`);
});
