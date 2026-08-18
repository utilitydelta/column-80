// ADVERSARIAL evidence file for session-v55 phase 10 (Q10), review pass.
//
// WHAT IT WITNESSES: refusing a single-letter call owner frees the KEEP slot,
// and freeing the keep slot makes the leg keep going. So a span whose calls sit
// on generic-parameter receivers now spends MORE `definition()` round trips
// than it did before the fix, not fewer and not the same.
//
// Contract item 1 says "the round trip that would have been spent on it is not
// spent". The implementation comment answers the contract's ordering question
// with "THE ROUND TRIP IS NOT SAVED". Both understate the direction: the leg
// spends up to `CALL_OWNER_LOOKUP_CAP` (6) round trips where it used to stop at
// `CALL_OWNER_CAP` (2).
//
// The pre-fix half is produced HERE, not quoted: the bundle is built once from
// the live source and a second copy is made with the new refusal block deleted
// from the BUNDLED text, so both halves run the same code with one `if`
// removed. If that block ever moves, the extraction fails loudly rather than
// skipping.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v55-p10-lookup-cost.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".adv-v55-p10-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = (globalThis.__advV55P10 = globalThis.__advV55P10 || { symbols: [] });
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a,b,c,d){ if(typeof a === "number"){this.start=new Position(a,b);this.end=new Position(c,d);} else {this.start=a;this.end=b;} } }
class ThemeColor { constructor(id){this.id=id;} }
class MarkdownString { constructor(){this.blocks=[];} appendCodeblock(t){this.blocks.push(t);} }
class Diagnostic { constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;} }
const Uri = { file:(p)=>({fsPath:p,path:p,scheme:"file",toString:()=>"file://"+p}), parse:(s)=>({raw:s,toString:()=>s}) };
module.exports = {
  __state: state, Position, Range, ThemeColor, MarkdownString, Diagnostic, Uri,
  DiagnosticSeverity: { Error:0, Warning:1, Information:2, Hint:3 },
  SymbolKind: { File:0, Module:1, Class:4, Method:5, Field:7, Enum:9, Interface:10, Function:11, Object:18, Struct:22 },
  workspace: { getConfiguration: () => ({ get:(k,fb)=>fb, inspect:()=>undefined, update: async()=>{} }), get textDocuments(){return [];}, openTextDocument: async (u)=>({uri:u,getText:()=>state.text||""}) },
  languages: { createDiagnosticCollection: (name)=>({name,set(){},delete(){},clear(){},dispose(){}}) },
  window: { createTextEditorDecorationType:(o)=>({o,dispose(){}}), get visibleTextEditors(){return[];}, showWarningMessage: async()=>{}, showInformationMessage: async()=>{}, setStatusBarMessage: ()=>({dispose(){}}) },
  commands: { executeCommand: async (cmd)=> (cmd === "vscode.executeDocumentSymbolProvider" ? state.symbols : undefined) },
};
`,
);

const entry = path.join(__dirname, ".adv-v55-p10.entry.ts");
const shipped = path.join(__dirname, ".adv-v55-p10.shipped.cjs");
const prefix = path.join(__dirname, ".adv-v55-p10.prefix.cjs");
fs.writeFileSync(entry, `export { resolveCallOwners } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: shipped, format: "cjs", platform: "node", alias: { vscode: STUB } });

// The shipped bundle minus the one `if` phase 10 added. Anchored on the
// refusal's own channel wording, so a reworded fix fails here loudly.
const text = fs.readFileSync(shipped, "utf8");
const BLOCK =
  /\n[ \t]*if \(lang\.singleLetterOwnerIsReal !== true && \/\^\[A-Z\]\$\/\.test\(typeName\)\) \{[\s\S]*?a generic parameter and not a type[\s\S]*?\n[ \t]*\}/;
const found = BLOCK.exec(text);
assert.ok(
  found,
  "the phase-10 refusal block is not in the bundle in the shape this file removes; re-point the regex before trusting any row here",
);
fs.writeFileSync(prefix, text.replace(BLOCK, ""));

const SHIPPED = require(shipped);
const PREFIX = require(prefix);
const state = globalThis.__advV55P10;

test.after(() => {
  [entry, shipped, prefix, STUB].forEach((f) => fs.rmSync(f, { force: true }));
});

const span = (a, b) => ({ start: { line: a, character: 0 }, end: { line: b, character: 1 } });
const container = (typeName, method, line) => ({
  name: typeName,
  kind: 22,
  range: span(line, line + 30),
  selectionRange: { start: { line, character: 5 }, end: { line, character: 5 + typeName.length } },
  children: [
    {
      name: method,
      kind: 5,
      range: span(line + 5, line + 9),
      selectionRange: { start: { line: line + 5, character: 11 }, end: { line: line + 5, character: 11 + method.length } },
      children: [],
    },
  ],
});
const defAt = (line) => ({ uri: "file:///x/owner.rs", range: { startLine: line + 5, startCharacter: 11, endLine: line + 5, endCharacter: 20 } });
const doc = { languageId: "rust", uri: { fsPath: "/x/a.rs", path: "/x/a.rs", scheme: "file", toString: () => "file:///x/a.rs" }, getText: () => "" };

// One run of the leg over N calls whose owners are the given container names.
// Returns what it kept and how many `definition()` round trips it spent.
async function run(mod, owners) {
  state.symbols = owners.map((t, i) => container(t, `call${i}`, 100 * (i + 1)));
  state.text = "";
  const defs = {};
  owners.forEach((_, i) => {
    defs[i + 1] = defAt(100 * (i + 1));
  });
  const asked = [];
  const kept = await mod.resolveCallOwners(
    {
      definition: async (c) => {
        asked.push(c.line);
        return defs[c.line];
      },
      completeMembers: async () => [],
      hoverSurface: async () => undefined,
      membersOfType: async () => [],
      example: async () => undefined,
      qualifyImport: async () => undefined,
    },
    doc,
    owners.map((_, i) => ({ name: `call${i}`, line: i + 1, character: 4, via: "member" })),
    () => {},
  );
  return { names: kept.map((o) => o.name), lookups: asked.length };
}

// ---------------------------------------------------------------------------
// ROW A. Every receiver is a generic parameter: 2 round trips become 6.
// ---------------------------------------------------------------------------
test("a span of generic-parameter receivers costs 3x the definition round trips it used to", async () => {
  const owners = ["T", "U", "K", "V", "E", "S"];
  const before = await run(PREFIX, owners);
  const after = await run(SHIPPED, owners);
  assert.deepEqual(before, { names: ["T", "U"], lookups: 2 }, "the pre-fix half of this comparison is not what it was measured to be");
  assert.deepEqual(
    after,
    { names: [], lookups: 6 },
    "the shipped leg no longer spends the whole lookup cap on generic receivers; re-measure this row's claim",
  );
});

// ---------------------------------------------------------------------------
// ROW B. Two generic receivers in front of four real ones: 2 become 4. The two
// extra round trips buy two real owners, which is the trade the fix makes and
// the trade the comment does not state.
// ---------------------------------------------------------------------------
test("two generic receivers in front of real ones double the round trips, and buy two real owners", async () => {
  const owners = ["T", "U", "Alpha", "Beta", "Gamma", "Delta"];
  const before = await run(PREFIX, owners);
  const after = await run(SHIPPED, owners);
  assert.deepEqual(before, { names: ["T", "U"], lookups: 2 });
  assert.deepEqual(after, { names: ["Alpha", "Beta"], lookups: 4 });
});

// ---------------------------------------------------------------------------
// ROW C. The same owner refused twice. Before the fix the second `T` hit the
// already-disclosed filter; now both are refused as parameters, so the refused
// name never enters `seen` and the channel repeats itself once per call.
// ---------------------------------------------------------------------------
test("a repeated generic owner is refused once per call, not deduped", async () => {
  state.symbols = [container("T", "call0", 100), container("T", "call1", 200)];
  state.text = "";
  const defs = { 1: defAt(100), 2: defAt(200) };
  const lines = [];
  const kept = await SHIPPED.resolveCallOwners(
    {
      definition: async (c) => defs[c.line],
      completeMembers: async () => [],
      hoverSurface: async () => undefined,
      membersOfType: async () => [],
      example: async () => undefined,
      qualifyImport: async () => undefined,
    },
    doc,
    [
      { name: "call0", line: 1, character: 4, via: "member" },
      { name: "call1", line: 2, character: 4, via: "member" },
    ],
    (l) => lines.push(l),
  );
  assert.deepEqual(kept, []);
  const refusals = lines.filter((l) => l.includes("a generic parameter and not a type"));
  assert.equal(refusals.length, 2, `channel: ${JSON.stringify(lines)}`);
});
