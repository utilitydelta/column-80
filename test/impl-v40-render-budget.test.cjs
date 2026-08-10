// IMPLEMENTER tests — session-v40 item 1: the render-pass budget on fn-gen's
// pre-fill leg. Complements the blind oracle (test/blind-v40-render-budget.test.cjs,
// which drives walkDataShape directly per its own documented structural
// assumption) by proving the fix reaches the two call sites the blind oracle
// cannot see into: Rust's `shapeBlock` and TypeScript's `tsShapeBlock`
// (src/vscode/fnGen.ts), through the SAME `prefillLangFor(...).renderShapeBlock`
// seam test/impl-v37-p6-primitive-alias.test.cjs already uses.
//
// Before this fix, both callers seeded walkDataShape with the REAL (finite)
// TOK_MAX, so a def that breached it - or the shared cross-candidate aggregate
// threaded across resolvePrefill's admitted-candidate loop - went dark: not
// even its name rendered. This session moved that enforcement into
// walkDataShape itself as a render-time, brace-safe truncation (see
// src/core/dataShape.ts's doc comments on `walkDataShape` and
// `renderDefsWithinBudget`), so every caller - including these two - gets it
// automatically.
//
// Run: SKIP_LIVE=1 node --test test/impl-v40-render-budget.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// fn-gen sits behind the vscode module — mechanics copied from
// test/impl-v37-p6-primitive-alias.test.cjs.
const STUB = path.join(__dirname, ".impl-v40-render-budget-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, Selection: Range, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: {}, EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: { getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }) },
};
`,
);
const ENTRY = path.join(__dirname, ".impl-v40-render-budget.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v40-render-budget.bundle.cjs");
fs.writeFileSync(
  ENTRY,
  [
    `export { prefillLangFor, FNGEN_PROFILE } from "../src/vscode/fnGen";`,
    `export { walkDataShape } from "../src/core/dataShape";`,
    "",
  ].join("\n"),
);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: OUTFILE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const M = require(OUTFILE);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const { FNGEN_PROFILE } = M;
const FENCE = "```";
const rustLang = M.prefillLangFor("rust");
const tsLang = M.prefillLangFor("typescript");

const freshShared = () => ({ visited: new Set(), remainingChars: FNGEN_PROFILE.totalTok * 4 });

// A flat N-field struct signature, Rust style, well over the per-walk TOK_MAX*4
// (800 chars) but comfortably under the shared aggregate (1200 chars) when it's
// the ONLY thing charged against it - forces PER-WALK truncation specifically.
const rustFlatDef = (name, n) =>
  `pub struct ${name} {\n` + Array.from({ length: n }, (_, i) => `    pub field_${i}: u64,`).join("\n") + `\n}`;
// Same shape, TypeScript style.
const tsFlatDef = (name, n) =>
  `interface ${name} {\n` + Array.from({ length: n }, (_, i) => `    field_${i}: number;`).join("\n") + `\n}`;

const braceCounts = (s) => ({
  open: (s.match(/\{/g) || []).length,
  close: (s.match(/\}/g) || []).length,
});
const markerN = (s) => {
  const m = /\.\.\. (\d+) more fields/.exec(s);
  return m ? Number(m[1]) : undefined;
};

const shapeOf = (types) => ({
  types: new Map(
    Object.entries(types).map(([name, t]) => [
      name,
      { name, signature: t.signature, fields: t.fields ?? [], methods: t.methods ?? [], methodsResolved: true, defUri: "file:///w/src/lib.rs" },
    ]),
  ),
  dropped: [],
});

// ===========================================================================
// 1. Rust's shapeBlock: a def that breaches the per-walk TOK_MAX*4 is
//    truncated brace-safe (marker present, header present, brace-balanced) -
//    not dropped whole, the pre-v40 bug.
// ===========================================================================
test("shapeBlock (Rust): a def past TOK_MAX*4 truncates with a marker, never goes dark", () => {
  const def = rustFlatDef("Huge", 60); // far exceeds 800 chars
  const shape = shapeOf({ Huge: { signature: def, fields: [] } });
  const block = rustLang.renderShapeBlock("Huge", shape, freshShared(), () => {}, FNGEN_PROFILE);

  assert.ok(block, "the oversized type still injects a block (not the honest-degrade undefined)");
  assert.match(block.text, /pub struct Huge \{/, "the header rendered");
  const n = markerN(block.text);
  assert.ok(n !== undefined && n > 0, `a "... N more fields" marker is present; got ${JSON.stringify(block.text)}`);
  const kept = (block.text.match(/field_\d+: u64,/g) || []).length;
  assert.strictEqual(kept + n, 60, `kept (${kept}) + marker N (${n}) == the true field count`);
  const { open, close } = braceCounts(block.text);
  assert.strictEqual(open, close, "brace-balanced");
});

// ===========================================================================
// 2. tsShapeBlock: the same contract, TypeScript-shaped.
// ===========================================================================
test("tsShapeBlock: a def past TOK_MAX*4 truncates with a marker, never goes dark", () => {
  const def = tsFlatDef("Huge", 60);
  const shape = shapeOf({ Huge: { signature: def, fields: [] } });
  const block = tsLang.renderShapeBlock("Huge", shape, freshShared(), () => {}, FNGEN_PROFILE);

  assert.ok(block, "the oversized type still injects a block");
  assert.match(block.text, /interface Huge \{/, "the header rendered");
  const n = markerN(block.text);
  assert.ok(n !== undefined && n > 0, `a marker is present; got ${JSON.stringify(block.text)}`);
  const { open, close } = braceCounts(block.text);
  assert.strictEqual(open, close, "brace-balanced");
});

// ===========================================================================
// 3. A def comfortably within budget still renders in FULL, byte-identical, no
//    marker - the fix must not truncate what already fit.
// ===========================================================================
test("shapeBlock (Rust): a small def renders in full, byte-identical, no marker", () => {
  const def = rustFlatDef("Small", 3);
  const shape = shapeOf({ Small: { signature: def, fields: [] } });
  const block = rustLang.renderShapeBlock("Small", shape, freshShared(), () => {}, FNGEN_PROFILE);

  assert.ok(block);
  const expected = `Data shape of \`Small\` (fields and types, nested):\n${FENCE}rust\n${def}\n${FENCE}`;
  assert.ok(block.text.includes(expected), "the data-shape section is byte-identical to the untruncated def, fenced");
  assert.match(block.text, /pub struct Small \{/);
  assert.ok(!markerN(block.text), "no marker line on an in-budget def");
  assert.ok(block.text.includes(def), "the untruncated def text appears verbatim");
});

// ===========================================================================
// 4. The shared cross-candidate budget: resolvePrefill threads ONE
//    SharedWalkState across MANY separate shapeBlock calls (one per admitted
//    candidate). A second, later candidate that would have been dropped whole
//    pre-v40 (the first candidate having spent most of the aggregate) must now
//    still surface a truncated shell, not vanish - the exact "shared-budget
//    starvation drops the WHOLE def" bug item 1 fixes, now proven through the
//    real call sites resolvePrefill uses, not just walkDataShape directly.
// ===========================================================================
test("shapeBlock (Rust): a later candidate composes with the shared aggregate - truncated, not dropped whole", () => {
  const first = rustFlatDef("First", 15); // sized to eat most, not all, of the 1200-char aggregate
  const second = rustFlatDef("Second", 15);
  const shape = shapeOf({
    First: { signature: first, fields: [] },
    Second: { signature: second, fields: [] },
  });
  const shared = freshShared();

  const blockA = rustLang.renderShapeBlock("First", shape, shared, () => {}, FNGEN_PROFILE);
  const blockB = rustLang.renderShapeBlock("Second", shape, shared, () => {}, FNGEN_PROFILE);

  assert.ok(blockA, "First renders");
  assert.ok(blockB, "Second still renders SOMETHING under the shared aggregate (pre-v40: undefined - fully dark)");
  assert.match(blockB.text, /pub struct Second \{/, "Second's header survives even if its fields are cut");
  const { open, close } = braceCounts(blockB.text);
  assert.strictEqual(open, close, "Second's (possibly truncated) block stays brace-balanced");
});

// ===========================================================================
// 5. Structural bounds are UNCHANGED: N_MAX still caps the total number of
//    defs emitted regardless of how generous TOK_MAX truncation is - the fix
//    only changed how the char budget is spent, not the 2-D structural bound.
// ===========================================================================
test("shapeBlock (Rust): N_MAX still caps total defs emitted even though TOK_MAX no longer drops them whole", () => {
  // FNGEN_PROFILE.dataShape.N_MAX == 6. A root with 10 distinct local child
  // types (well under B_MAX won't bind since B_MAX==4... use B_MAX-sized fanout
  // per node but enough total nodes across depth to exceed N_MAX).
  const kids = Array.from({ length: 4 }, (_, i) => `K${i}`);
  const types = {
    Root: {
      signature: `pub struct Root {\n${kids.map((k) => `    pub ${k.toLowerCase()}: ${k},`).join("\n")}\n}`,
      fields: kids.map((k) => ({ name: k.toLowerCase(), typeName: k })),
    },
  };
  for (const k of kids) {
    types[k] = { signature: `pub struct ${k} {\n    pub v: u64,\n}`, fields: [] };
  }
  const shape = shapeOf(types);
  const block = rustLang.renderShapeBlock("Root", shape, freshShared(), () => {}, FNGEN_PROFILE);
  assert.ok(block);
  const structCount = (block.text.match(/pub struct \w+ \{/g) || []).length;
  assert.ok(structCount <= FNGEN_PROFILE.dataShape.N_MAX, `structCount=${structCount} must not exceed N_MAX=${FNGEN_PROFILE.dataShape.N_MAX}`);
});

// ===========================================================================
// 6. dataShape.ts's own render-time truncation, driven directly (mirrors the
//    blind oracle's own setup, kept here so a white-box run alone still
//    exercises walkDataShape without the fn-gen bundle).
// ===========================================================================
test("walkDataShape: a truncated def's `defs` entry carries the TRUNCATED text, not the raw original", () => {
  const def = rustFlatDef("Big", 60);
  const resolveStruct = (name) => (name === "Big" ? { def, fields: [] } : undefined);
  const bounds = { D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: 200 }; // 800 chars, def is far bigger
  const result = M.walkDataShape("Big", resolveStruct, bounds);
  assert.strictEqual(result.defs.length, 1);
  assert.notStrictEqual(result.defs[0].def, def, "defs[0].def is the truncated form, not byte-identical to the oversized source");
  assert.ok(result.defs[0].def.length < def.length, "the truncated form is strictly smaller");
  assert.strictEqual(result.defs[0].def, result.block, "defs and block agree (single-def walk)");
});
