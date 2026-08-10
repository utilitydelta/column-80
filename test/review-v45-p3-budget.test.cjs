// ADVERSARIAL REVIEW - session-v45 phase 3 (the per-language aggregate render
// budget). Contract: session-v45/contract-phase3.md.
//
// FAILING rows are defect claims with evidence. PASSING rows are attacks that
// did not land, kept as the record.
//
// Rows:
//   R1  the no-op claim under the TEST-GEN profile. `resolvePrefill` serves both
//       gestures and picks TESTGEN_PROFILE (totalTok 500) when
//       `forConstruction` is set. A language budget declared at 300 now WINS
//       over that 500, so a C# test-gen prefill lost 800 chars of aggregate
//       budget at the shipped value. A/B: this bundle vs the same bundle with
//       `CS_DATASHAPE_TOTAL_TOK` neutered back to the pre-phase-3 fallback.
//   R2  the same A/B under FN-GEN (control). Must be identical - the no-op
//       claim is true for this gesture.
//   R3  reachability, BEHAVIOURALLY (the contract's "falsification depth"):
//       move C#'s own constant in the bundle and the walk must admit more, with
//       Rust unmoved by the same patch.
//   R4  the rig knob, BEHAVIOURALLY: patch `var DATASHAPE_TOTAL_TOK = 300;`
//       the way lib-core's loadPrefillBudget does, and C# must run at the
//       PATCHED value. The impl test asserts this with a regex over the SOURCE,
//       which cannot see a bundler folding the ternary.
//
// Run: SKIP_LIVE=1 node --test test/review-v45-p3-budget.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v45-p3-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V45P3_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".review-v45-p3.entry.ts");
const OUT = path.join(__dirname, ".review-v45-p3.bundle.cjs");
// The three derived bundles: the pre-phase-3 fallback, C#'s own constant moved,
// and the rig's shared knob moved.
const OUT_PRE = path.join(__dirname, ".review-v45-p3.pre.bundle.cjs");
const OUT_CS900 = path.join(__dirname, ".review-v45-p3.cs900.bundle.cjs");
const OUT_KNOB900 = path.join(__dirname, ".review-v45-p3.knob900.bundle.cjs");
const ARTIFACTS = [STUB, ENTRY, OUT, OUT_PRE, OUT_CS900, OUT_KNOB900];

let mod;
let modPre;
let modCs900;
let modKnob900;
let bundleErr;
let srcBundle = "";
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill, prefillTotalTok } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
  mod = require(OUT);
  srcBundle = fs.readFileSync(OUT, "utf8");

  // PRE-PHASE-3. Neutering C#'s constant to `void 0` makes `prefillTotalTok`
  // fall through to the gesture profile, which is byte-for-byte what the
  // committed code did before this phase (`remainingChars: profile.totalTok * 4`).
  const reCs = /var CS_DATASHAPE_TOTAL_TOK = [^;\n]+;/;
  if (!reCs.test(srcBundle)) throw new Error("C#'s budget constant is not in the bundle under a name this file knows");
  fs.writeFileSync(OUT_PRE, srcBundle.replace(reCs, "var CS_DATASHAPE_TOTAL_TOK = void 0;"));
  modPre = require(OUT_PRE);

  fs.writeFileSync(OUT_CS900, srcBundle.replace(reCs, "var CS_DATASHAPE_TOTAL_TOK = 900;"));
  modCs900 = require(OUT_CS900);

  // The rig's exact substitution (lib-core.cjs loadPrefillBudget).
  const reKnob = /var DATASHAPE_TOTAL_TOK = \d+;/;
  if (!reKnob.test(srcBundle)) throw new Error("the rig's budget-knob pattern does not match the bundle");
  fs.writeFileSync(OUT_KNOB900, srcBundle.replace(reKnob, "var DATASHAPE_TOTAL_TOK = 900;"));
  modKnob900 = require(OUT_KNOB900);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => ARTIFACTS.forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: four bundles build - shipped, pre-phase-3, C#-moved, knob-moved", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const [name, m] of [["shipped", mod], ["pre", modPre], ["cs900", modCs900], ["knob900", modKnob900]]) {
    assert.equal(typeof m.resolvePrefill, "function", `${name}: resolvePrefill must be callable`);
  }
});
// Options pass-through added by TRIAGE so a row can carry a `todo` ruling. The
// wrapper originally took (name, fn) only, which silently swallowed an options
// object as the test body.
const btest = (name, optsOrFn, maybeFn) => {
  const opts = typeof optsOrFn === "function" ? undefined : optsOrFn;
  const fn = typeof optsOrFn === "function" ? optsOrFn : maybeFn;
  const run = (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  };
  return opts === undefined ? test(name, run) : test(name, opts, run);
};

// ===========================================================================
// Fixtures. Deliberately FAT: the aggregate budget only shows itself when the
// candidates cost more than it can pay for. Six candidates against a type cap
// of 4, each with six long member signatures.
// ===========================================================================

const WS = "file:///work/v45p3";
const SIX = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

const csMembers = (t) =>
  Array.from({ length: 6 }, (_, i) => ({
    name: `Compute${i}`,
    kind: "method",
    signature: `public System.Threading.Tasks.Task<uint> Compute${i}(uint operandNumber${i}, string labelForOperand${i})`,
    uri: `${WS}/${t.toLowerCase()}.cs`,
    line: 0,
    character: 13,
  }));

const rustMembers = (t) =>
  Array.from({ length: 6 }, (_, i) => ({
    name: `compute${i}`,
    kind: "method",
    signature: `pub fn compute${i}(&self, operand_number_${i}: u32, label_for_operand_${i}: &str) -> u32`,
    uri: `${WS}/${t.toLowerCase()}.rs`,
    line: 0,
    character: 7,
  }));

const FIXTURES = {
  csharp: {
    ext: "cs",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint Slot; }\n`,
    hover: (t) => `class ${t}`,
    members: csMembers,
  },
  rust: {
    ext: "rs",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot_number_field: u32, pub label_for_the_slot: String }\n`,
    hover: (t) => `pub struct ${t} {\n    pub slot_number_field: u32,\n    pub label_for_the_slot: String,\n}`,
    members: rustMembers,
  },
};

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// The injected types, read off the payload the way a reader would.
function injectedTypes(out) {
  const lines = (out || "").split("\n");
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    if (!((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```"))) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

async function runPrefill(resolvePrefill, languageId, opts) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(SIX);
  const src = `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of SIX) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    files[uri] = F.def(t);
    defTypes[t] = { uri, hover: F.hover(t), members: F.members(t) };
  }
  const start = src.indexOf(signature);
  const record = {
    span: { start, end: src.length - 1 },
    signature,
    docComment: F.doc,
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__V45P3_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)), opts);
  } finally {
    delete globalThis.__V45P3_FILES__;
  }
  return { text: out || "", logs, names: injectedTypes(out) };
}

const TESTGEN = { forConstruction: true, importTargetPath: `${WS}/tests/BuildTests.cs` };
const dump = (tag, r) => `\n  [${tag}] injected=${JSON.stringify(r.names)} chars=${r.text.length}\n  logs=${JSON.stringify(r.logs, null, 1)}\n  payload:\n${r.text}`;

// ===========================================================================
// R1. The no-op claim, under the TEST-GEN profile.
// ===========================================================================

btest("R1: a C# TEST-GEN prefill is NOT a no-op - the language's 300 overrides TESTGEN_PROFILE's 500", async () => {
  const now = await runPrefill(mod.resolvePrefill, "csharp", TESTGEN);
  const before = await runPrefill(modPre.resolvePrefill, "csharp", TESTGEN);
  assert.equal(
    now.text,
    before.text,
    "contract-phase3 claim 1 says the phase is a byte-for-byte no-op in behaviour at the shipped value, " +
      "ALL FIVE languages. resolvePrefill picks TESTGEN_PROFILE (totalTok 500) when forConstruction is set " +
      "(fnGen.ts:1995) and then asks prefillTotalTok(lang, profile), which prefers the LANGUAGE's value " +
      "(fnGen.ts:1451). C# now declares 300, so a C# test-gen prefill's aggregate budget fell 500 -> 300 " +
      "tokens, i.e. 2000 -> 1200 chars." +
      dump("phase 3", now) +
      dump("pre-phase 3", before),
  );
});

btest("R2 (control): a C# FN-GEN prefill IS a no-op, byte for byte", async () => {
  const now = await runPrefill(mod.resolvePrefill, "csharp", undefined);
  const before = await runPrefill(modPre.resolvePrefill, "csharp", undefined);
  assert.equal(now.text, before.text, `fn-gen must be identical${dump("phase 3", now)}${dump("pre-phase 3", before)}`);
  assert.deepEqual(now.logs, before.logs, "the channel lines must be identical too");
});

// ===========================================================================
// R3. Reachability, behaviourally. The contract's "falsification depth" asks
// for exactly this and the impl test does not have it.
// ===========================================================================

btest("R3: C#'s own constant REACHES the walk - moving it to 900 admits more, and Rust does not move with it", async () => {
  const base = await runPrefill(mod.resolvePrefill, "csharp", undefined);
  const wide = await runPrefill(modCs900.resolvePrefill, "csharp", undefined);
  assert.ok(
    wide.text.length > base.text.length,
    `C#'s budget must be live at the walk: 300 -> 900 rendered ${base.text.length} -> ${wide.text.length} chars` +
      dump("cs 300", base) +
      dump("cs 900", wide),
  );
  const rustBase = await runPrefill(mod.resolvePrefill, "rust", undefined);
  const rustWide = await runPrefill(modCs900.resolvePrefill, "rust", undefined);
  assert.equal(
    rustWide.text,
    rustBase.text,
    `moving C#'s constant must not move Rust${dump("rust @ cs300", rustBase)}${dump("rust @ cs900", rustWide)}`,
  );
});

// ===========================================================================
// R4. The rig knob, behaviourally.
// ===========================================================================

btest("R4: the rig's knob still wins - lib-core's exact patch of `var DATASHAPE_TOTAL_TOK` moves C# too", async () => {
  const base = await runPrefill(mod.resolvePrefill, "csharp", undefined);
  const armed = await runPrefill(modKnob900.resolvePrefill, "csharp", undefined);
  assert.ok(
    armed.text.length > base.text.length,
    "a budget-900 arm must reach C#, or the rung silently duplicates the shipping run (adversarial-v42-p2 R1). " +
      `Got ${base.text.length} -> ${armed.text.length} chars` +
      dump("shipped", base) +
      dump("knob 900", armed),
  );
});

// ===========================================================================
// R5. FORWARD HAZARD, for phase 4.1. The ternary's guard is the SENTINEL value
// 300. The moment the generation arm sets C#'s value to anything else, the one
// rung a ladder cannot reach for C# is 300 - the BASELINE rung. This row
// simulates that state (C# value 900) and then applies lib-core's exact
// loadPrefillBudget(300, 0) patch, which is how a ladder asks for the shipped
// baseline.
// ===========================================================================

btest("R5: once C#'s value differs, a budget-300 rung silently measures C#'s own value, not 300", {
  todo:
    "RULED by triage: the DEFECT is fixed, by a different remedy than this row simulates. R5 is right " +
    "that a `=== 300` sentinel cannot tell UNPATCHED from PATCHED-TO-300, and that once C#'s value " +
    "differed the baseline rung became unreachable. The sentinel is gone: the shipped form is now " +
    "`CS_DATASHAPE_TOTAL_TOK = DATASHAPE_TOTAL_TOK * CS_BUDGET_FACTOR` (factor 1), which removes the " +
    "conflation entirely and makes every rung dense in the knob - knob 100 x factor 3 = the 300 " +
    "baseline. This row constructs the sentinel form to demonstrate the trap, so it cannot pass " +
    "against a tree that no longer contains it. Kept RED rather than deleted because it is the " +
    "record of why the shipped form is a factor. The replacement proof is in " +
    "impl-v45-p3-budget.test.cjs, 'under a FUTURE phase-4.1 factor, every ladder rung ... is reachable'.",
}, async () => {
  const AFTER_41 = path.join(__dirname, ".review-v45-p3.after41.bundle.cjs");
  const AFTER_41_BASE = path.join(__dirname, ".review-v45-p3.after41base.bundle.cjs");
  ARTIFACTS.push(AFTER_41, AFTER_41_BASE);
  const reCs = /var CS_DATASHAPE_TOTAL_TOK = [^;\n]+;/;
  // Phase 4.1's one-line change, as the contract describes it.
  const after41 = srcBundle.replace(reCs, "var CS_DATASHAPE_TOTAL_TOK = DATASHAPE_TOTAL_TOK === 300 ? 900 : DATASHAPE_TOTAL_TOK;");
  fs.writeFileSync(AFTER_41, after41);
  // The rig asking for the 300 rung. lib-core's guard is satisfied: the pattern
  // matched and the substitution happened.
  fs.writeFileSync(AFTER_41_BASE, after41.replace(/var DATASHAPE_TOTAL_TOK = \d+;/, "var DATASHAPE_TOTAL_TOK = 300;"));
  const wide = await runPrefill(require(AFTER_41).resolvePrefill, "csharp", undefined);
  const rung300 = await runPrefill(require(AFTER_41_BASE).resolvePrefill, "csharp", undefined);
  const trueBaseline = await runPrefill(mod.resolvePrefill, "csharp", undefined);
  assert.equal(
    rung300.text,
    trueBaseline.text,
    "a budget-300 rung for C# must render what a real 300-token budget renders. It renders C#'s own 900 " +
      `instead (${rung300.text.length} chars vs the true baseline's ${trueBaseline.text.length}), because ` +
      "`DATASHAPE_TOTAL_TOK === 300` is satisfied by the patch itself. lib-core's loadPrefillBudget and " +
      "loadPrefillCapBudget have no csharp leg and their guard cannot fire - the pattern still matches. " +
      `The 900 rung renders ${wide.text.length} chars, so the 300 and 900 rungs are the SAME rung.` +
      dump("rung 300 (after 4.1)", rung300) +
      dump("true 300 baseline", trueBaseline),
  );
});

btest("R4b: the knob patch site is still unique, so lib-core's loadPrefillBudget guard cannot mis-fire", () => {
  const hits = srcBundle.match(/var DATASHAPE_TOTAL_TOK = \d+;/g) ?? [];
  assert.equal(
    hits.length,
    1,
    `loadPrefillBudget throws unless exactly 1 site exists; found ${hits.length}: ${JSON.stringify(hits)}`,
  );
});
