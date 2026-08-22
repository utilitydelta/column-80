// REVIEW - session-v50 phase 4. THE BLAST-RADIUS RE-ARGUMENT for the v42
// starvation ruling, in C# and Python, with bytes.
//
// WHY THIS FILE EXISTS. session-v42 ruled that a fat type costs the prompt
// nothing, because its field shape was discarded before it could reach the
// prompt. session-v49 lit Go's field leg, re-argued that ruling with a byte
// measurement (test/adversarial-v42-p2.test.cjs, row B1) and it held: Go
// starvation became reachable, and it is DISCLOSED - each starved type named
// twice, on its own walk's drop line and on the aggregate line, and every
// starved type keeps its full member block. session-v50 lit the SAME leg in C#
// (phase 2, csShapeBlock) and Python (phase 3, pyShapeBlock). Both now run
// walkDataShape and emit a `Data shape of X` block ahead of the member blocks,
// competing for the same shared per-prompt budget. The goal says re-argue,
// with bytes, rather than re-cut. This is that re-argument.
//
// THE INSTRUMENT, and it is the same one on both sides. One fixture per
// language: 8 types, each with N fields and one method, every type named in the
// target's own signature so all 8 are candidates in a fixed priority order.
// The prompt is rendered through the product's own `resolvePrefill`, and the
// bound is read from the product's own `budgetProfileFor`, never re-derived.
//
// The BEFORE side flips exactly one thing: the kind the transport puts on a
// data member. C# and Python both derive their fields from `membersOfType`
// (csFieldsFromMembers / pyFieldsFromMembers, `kind === "field"`), so a member
// arriving as `other` is the pre-leg input verbatim - no shape block, no
// shedding - while `renderMemberSignatures` ignores kind, so the member LINES
// are byte-identical between the two sides. One variable, product render on
// both sides.
//
// WHAT THE BEFORE COLUMN SAYS, and it is not what Go's said. Go's before column
// was FLAT: 1148 bytes whether the structs carried 1 field or 10, because no
// field ever reached the prompt. Neither of these languages was ever like that.
// C# and Python fields have shipped as member LINES all along, so a fat type
// has always cost prompt bytes here. The v42 mechanism - shape discarded before
// the prompt - was a Go fact, and it does not transfer.
//
// C#'s COLUMN MOVED IN session-v51, AND THE NUMBERS BELOW ARE THE MOVED ONES.
// Read them as post-v51, not as v50's. session-v51 phase 0 changed how the
// shared per-prompt aggregate is apportioned in C#, and only in C#:
// `resolvePrefill` now prices the WHOLE prompt's member
// blocks before the first shape block renders, and a shape block may only spend
// what is left over that price plus what its own type's member block will shed
// once the shape block has printed those fields. A walk that cannot repay what
// it spent is refused whole and refunded. Python's column and Go's are untouched
// by that change, because neither language's member half spends this aggregate.
// Every Python width v50 recorded re-measures to the same byte here, which is
// the out-of-scope clause of the contract holding.
//
// RE-MEASURED 2026-08-11 after that change, 8 types, `small` stop (the install
// default), aggregate budget 600 tok, member cap 48, root cap 8. Both sides
// re-run, at every width the file quotes:
//
//   C#           | before | after | shapes | member blocks, before -> after | neither
//   1 field      |   1324 |  2004 |      8 |                      8 -> 8    |       0
//   10 fields    |   2212 |  3180 |      8 |                      8 -> 8    |       0
//   15 fields    |   2724 |  2724 |      0 |                      8 -> 8    |       0
//   20 fields    |   2482 |  2804 |      2 |                      6 -> 6    |       2
//   25 fields    |   2437 |  2799 |      2 |                      5 -> 5    |       3
//   30 fields    |   2742 |  2742 |      0 |                      5 -> 5    |       3
//
//   Python       | before | after | shapes | member blocks, before -> after | neither
//   1 field      |   1448 |  2104 |      8 |                      8 -> 8    |       0
//   10 fields    |   2168 |  3112 |      8 |                      8 -> 8    |       0
//   15 fields    |   2568 |  3672 |      8 |                      8 -> 8    |       0
//   20 fields    |   2968 |  4232 |      8 |                      8 -> 8    |       0
//   25 fields    |   3368 |  4436 |      6 |                      8 -> 8    |       0
//   30 fields    |   3768 |  4758 |      5 |                      8 -> 8    |       0
//
// THE `neither` COLUMN IS NOT A LOSS. It counts types the prompt left with no
// block at all, and in C# from 20 fields up the BEFORE side leaves exactly the
// same types with nothing. At 20 fields a member block costs 354 chars and eight
// of them do not fit an aggregate of 2400, so `Golfs` and `Hotel` were already
// empty-handed before any shape block existed, and the blocks only get bigger at
// 25 and 30. No type is emptied by the field leg at any width here.
//
// WHY THE C# SHAPE COUNT IS NOT MONOTONE - 8 shapes at 10 fields, 0 at 15, 2 at
// 20, 0 at 30 - and it is the floor's arithmetic, not a wobble. What a shape
// block may spend is the aggregate MINUS the price of the member blocks still
// owed, plus what its own member block sheds. At 15 fields all eight member
// blocks still fit (8 x 293 = 2344 of 2400), so the surplus is 56 chars and no
// walk can afford a complete def. At 20 and 25 fields the member half alone
// overruns the aggregate, only six then five member blocks are priced at all,
// and the unpriced tail leaves 276 then 310 chars of genuine surplus, which buys
// two complete shape blocks. At 30 fields five blocks price at 2395 of 2400 and
// the surplus is 5 chars, so nothing renders again.
//
// THE VERDICT, per language, is in the rows below. Python matches Go: starvation
// is reachable at 25 fields x 8 types, every starved type is named twice, and
// every starved type keeps its FULL member block. C# now matches them on the
// thing that matters and pays for it in shape blocks: at no width does a type
// lose a member block, a member line, or its last block, and at 15 and 30 fields
// the post-leg prompt is byte-identical to the pre-leg prompt because every walk
// was refused. What C# starves is the DATA SHAPE, at every width from 15 up, and
// every starved type is named twice on the channel. P4-7 is the guard and it is
// GREEN.
//
// Run: SKIP_LIVE=1 node --test test/review-v50-p4-starvation.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v50-p4-vscode-stub.cjs");
const ENTRY = path.join(__dirname, ".review-v50-p4.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v50-p4.bundle.cjs");

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
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection: class extends Range {}, WorkspaceEdit: class {},
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
      const files = globalThis.__V50P4_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

let FN;
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";\n` +
      `export { budgetProfileFor, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  FN = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = (() => {
  try {
    return require(STUB);
  } catch {
    return undefined;
  }
})();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`bundle broken: ${bundleErr.message}`);
    return fn(ctx);
  });

// ===========================================================================
// THE FIXTURES. Eight types, one method each, N data members each. The field
// TYPES are lowercase scalars on purpose: the candidate scan is PascalCase, so
// no field opens a collaborator edge and the only thing under measurement is
// the shared budget.
// ===========================================================================

const NAMES = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"];

const B = (s) => Buffer.byteLength(String(s), "utf8");

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
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
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const csField = (i) => `Fa${String(i).padStart(2, "0")}`;
const pyField = (i) => `fa${String(i).padStart(2, "0")}`;

// A distinct uri per run. resolvePrefill leaves background work in flight, and
// two runs sharing one uri would let a straggler read a later run's source.
const uriFor = (lang, fieldCount, kind) => `file:///w/v50p4/${lang}-${fieldCount}-${kind}`;

function csFixture(fieldCount, kind) {
  const uri = uriFor("cs", fieldCount, kind) + "/App.cs";
  const lines = [];
  const members = {};
  const hovers = {};
  for (const n of NAMES) {
    hovers[n] = `class App.${n}`;
    members[n] = [];
    lines.push(`public class ${n}`);
    lines.push("{");
    for (let i = 0; i < fieldCount; i++) {
      const t = i % 2 ? "int" : "string";
      members[n].push({ name: csField(i), kind, signature: `${csField(i)} : ${t}`, declLine: lines.length });
      lines.push(`    public ${t} ${csField(i)};`);
    }
    members[n].push({ name: "Settle", kind: "method", signature: "Settle(int) : bool", declLine: lines.length });
    lines.push("    public bool Settle(int amount) { return true; }");
    lines.push("}", "");
  }
  const signature = `public uint Build(${NAMES.map((n, i) => `${n} p${i}`).join(", ")})`;
  const src = lines
    .concat(["/// <summary>Rebuild the registry.</summary>", signature, "{", "    throw new NotImplementedException();", "}", ""])
    .join("\n");
  return {
    uri,
    src,
    members,
    hovers,
    declRe: (t) => new RegExp(`^public class ${t}\\b`),
    fence: "cs",
    fieldLineRe: /^\s+Fa\d\d : /,
    record: {
      span: { start: src.indexOf(signature), end: src.length - 1 },
      signature,
      docComment: "Rebuild the registry.",
      symbolName: "Build",
      languageId: "csharp",
      kind: "method",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "    ",
    },
  };
}

function pyFixture(fieldCount, kind) {
  const uri = uriFor("py", fieldCount, kind) + "/app.py";
  const lines = [];
  const members = {};
  const hovers = {};
  for (const n of NAMES) {
    hovers[n] = `(class) ${n}`;
    members[n] = [];
    lines.push(`class ${n}:`);
    for (let i = 0; i < fieldCount; i++) {
      const t = i % 2 ? "int" : "str";
      members[n].push({ name: pyField(i), kind, signature: `${pyField(i)}: ${t}`, declLine: lines.length });
      lines.push(`    ${pyField(i)}: ${t}`);
    }
    members[n].push({ name: "settle", kind: "method", signature: "settle(self, amount: int) -> bool", declLine: lines.length });
    lines.push("    def settle(self, amount: int) -> bool:", "        raise NotImplementedError", "", "");
  }
  const signature = `def build(${NAMES.map((n, i) => `p${i}: ${n}`).join(", ")}) -> int`;
  const src = lines.concat([`${signature}:`, '    """Rebuild the registry."""', "    raise NotImplementedError", ""]).join("\n");
  return {
    uri,
    src,
    members,
    hovers,
    declRe: (t) => new RegExp(`^class ${t}\\b`),
    fence: "python",
    fieldLineRe: /^\s+fa\d\d: /,
    record: {
      span: { start: src.indexOf(signature), end: src.length - 1 },
      signature,
      docComment: '"""Rebuild the registry."""',
      symbolName: "build",
      languageId: "python",
      kind: "function",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "    ",
    },
  };
}

// The fake transport answers from the fixture's own table, keyed by the type
// name AT THE CURSOR - a real server is handed a position, not a name.
function extractorFor(fix) {
  const lines = fix.src.split("\n");
  const known = new Set(Object.keys(fix.members));
  const typeAt = (c) => {
    const w = wordAt(fix.src, c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const ln = lines.findIndex((l) => fix.declRe(t).test(l));
      if (ln < 0) return undefined;
      const ch = lines[ln].indexOf(t);
      return { uri: fix.uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t ? { signature: fix.hovers[t] } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      return t ? fix.members[t].map((m) => ({ ...m })) : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const sectionOf = (text, lead, name) => {
  const i = String(text).indexOf(`${lead} \`${name}\``);
  if (i < 0) return undefined;
  const open = String(text).indexOf("```", i);
  const close = String(text).indexOf("```", open + 3);
  return open < 0 || close < 0 ? undefined : String(text).slice(i, close + 3);
};

/** One render, through the product. `kind` is the only variable between the
 *  before side (`other`, the pre-leg transport) and the after side (`field`). */
async function measure(make, fieldCount, kind) {
  const fix = make(fieldCount, kind);
  const logs = [];
  const disclosed = [];
  // MERGED, never deleted: a straggler that finds the file map gone reports as
  // an unhandled rejection after the row that started it has ended.
  globalThis.__V50P4_FILES__ = { ...(globalThis.__V50P4_FILES__ || {}), [fix.uri]: fix.src };
  const text =
    (await FN.resolvePrefill(extractorFor(fix), makeDoc(fix.src, fix.uri), fix.record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)),
    })) || "";
  const shaped = NAMES.filter((n) => text.includes(`Data shape of \`${n}\``));
  const membered = NAMES.filter((n) => text.includes(`Members of \`${n}\``));
  return {
    fix,
    text,
    logs,
    disclosed,
    bytes: B(text),
    shaped,
    membered,
    starved: NAMES.filter((n) => !shaped.includes(n)),
    neither: NAMES.filter((n) => !shaped.includes(n) && !membered.includes(n)),
    fieldsIn: (n) => (sectionOf(text, "Data shape of", n) || "").split("\n").filter((l) => fix.fieldLineRe.test(l)).length,
  };
}

const dump = (m) => `\nSHAPED: ${m.shaped.join(",") || "-"}\nMEMBERS: ${m.membered.join(",") || "-"}\nLOGS:\n${m.logs.join("\n")}\nPROMPT:\n${m.text}`;

// ===========================================================================
// THE GUARD. Every number below is the product's, read off the product's own
// profile builder - a re-derived bound is the failure mode this file's whole
// argument would die of.
// ===========================================================================

btest("guard: the bundle builds and the bound under measurement is the product's own, not a re-derived one", () => {
  assert.equal(typeof FN.resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
  assert.equal(typeof FN.budgetProfileFor, "function", "budgetProfileFor must be exported from src/core/budgetProfile");
  for (const lang of ["csharp", "python"]) {
    const p = FN.budgetProfileFor("local-mid", lang, FN.DEFAULT_CONTEXT_STOP);
    assert.equal(p.stop, "small", `the install default is the stop under measurement (${lang})`);
    assert.equal(p.surfaceBudgetTok, 600, `the shared aggregate the shape blocks and the member blocks compete for (${lang})`);
    assert.equal(p.rootCap, 8, `eight roots, so the fixture's eight types all get a slot and only the BUDGET can bind (${lang})`);
    assert.equal(p.memberCap, 48, `48 members per type, so 30 fields plus a method never trips the member cap (${lang})`);
  }
});

// ===========================================================================
// P4-1 / P4-2. THE BYTES. Does a fat type now cost the prompt bytes it did not
// cost before?
// ===========================================================================

btest("P4-1 [csharp]: a fat C# type ALWAYS cost prompt bytes - the v42 'shape discarded' mechanism was never true here - and the field leg adds 968 more at 10 fields", async () => {
  const b1 = await measure(csFixture, 1, "other");
  const b10 = await measure(csFixture, 10, "other");
  const a1 = await measure(csFixture, 1, "field");
  const a10 = await measure(csFixture, 10, "field");

  // THE COLUMN THAT IS NOT GO'S. Go's before column was 1148 bytes at 1 field
  // AND at 10, because the hover carrying the fields was thrown away. C# fields
  // have arrived on `membersOfType` and shipped as member LINES all along, so
  // the before column MOVES. Anyone re-arguing the v42 ruling by analogy from
  // Go would get this backwards.
  assert.equal(b1.bytes, 1324, `before the leg, 8 types x 1 field.${dump(b1)}`);
  assert.equal(b10.bytes, 2212, `before the leg, 8 types x 10 fields. Flat would mean the Go mechanism; it is not flat.${dump(b10)}`);
  assert.ok(b10.bytes > b1.bytes, `a fat C# type cost bytes BEFORE this session: ${b1.bytes} -> ${b10.bytes}`);

  // What the leg actually buys and costs: the same fields, printed once as a
  // declaration and SHED from the member list, plus one header and fence pair
  // per type.
  assert.equal(a1.bytes, 2004, `after the leg, 8 types x 1 field.${dump(a1)}`);
  assert.equal(a10.bytes, 3180, `after the leg, 8 types x 10 fields.${dump(a10)}`);
  assert.equal(a10.bytes - b10.bytes, 968, `the leg's own cost at 10 fields x 8 types, in bytes.${dump(a10)}`);
  assert.deepEqual(a10.shaped, NAMES, `all eight render a data shape at this width.${dump(a10)}`);
  assert.deepEqual(a10.membered, NAMES, `and all eight still render a member block.${dump(a10)}`);
  // The shed, which is why the cost is 968 and not the whole field list twice.
  assert.equal(
    (sectionOf(a10.text, "Members of", "Alpha") || "").includes("Fa00"),
    false,
    `a field the shape block printed is shed from the member list.${dump(a10)}`,
  );
});

btest("P4-2 [python]: the same, in Python - the before column moves too, and the leg adds 944 bytes at 10 fields", async () => {
  const b1 = await measure(pyFixture, 1, "other");
  const b10 = await measure(pyFixture, 10, "other");
  const a1 = await measure(pyFixture, 1, "field");
  const a10 = await measure(pyFixture, 10, "field");

  assert.equal(b1.bytes, 1448, `before the leg, 8 types x 1 field.${dump(b1)}`);
  assert.equal(b10.bytes, 2168, `before the leg, 8 types x 10 fields.${dump(b10)}`);
  assert.ok(b10.bytes > b1.bytes, `a fat Python type cost bytes BEFORE this session: ${b1.bytes} -> ${b10.bytes}`);

  assert.equal(a1.bytes, 2104, `after the leg, 8 types x 1 field.${dump(a1)}`);
  assert.equal(a10.bytes, 3112, `after the leg, 8 types x 10 fields.${dump(a10)}`);
  assert.equal(a10.bytes - b10.bytes, 944, `the leg's own cost at 10 fields x 8 types, in bytes.${dump(a10)}`);
  assert.deepEqual(a10.shaped, NAMES, `all eight render a data shape at this width.${dump(a10)}`);
  assert.deepEqual(a10.membered, NAMES, `and all eight still render a member block.${dump(a10)}`);
  assert.equal(
    (sectionOf(a10.text, "Members of", "Alpha") || "").includes("fa00"),
    false,
    `a field the shape block printed is shed from the member list.${dump(a10)}`,
  );
});

// ===========================================================================
// P4-3 / P4-4. IS STARVATION REACHABLE, AND AT WHAT SHAPE?
// ===========================================================================

// P4-3 KEEPS ITS QUESTION - is starvation reachable in C#, and at what shape -
// and RE-CUTS ITS ANSWER, because session-v51 phase 0 moved the answer. Under
// v50 the answer was "reachable at 15 fields, and what it takes is a member
// block". Under the member floor it is "reachable at 15 fields, and what it
// takes is only ever the data-shape block".
btest("P4-3 [csharp]: starvation is REACHABLE and the DATA SHAPE is the only thing it takes - at 8 x 15 no shape block renders at all and the prompt is the pre-leg prompt, byte for byte", async () => {
  const b15 = await measure(csFixture, 15, "other");
  const w15 = await measure(csFixture, 15, "field");
  assert.equal(w15.shaped.length, 0, `not one of the 8 types can afford a shape block at 15 fields.${dump(w15)}`);
  assert.deepEqual(w15.starved, NAMES, `so all eight are shape-starved.${dump(w15)}`);
  assert.deepEqual(w15.membered, NAMES, `and all eight keep the member block the pre-leg render gave them.${dump(w15)}`);
  assert.deepEqual(w15.neither, [], `no type is left in the prompt with nothing.${dump(w15)}`);
  // THE STRONGEST FORM OF "THE LEG COST THEM NOTHING": every walk was refused
  // and refunded, so the post-leg prompt IS the pre-leg prompt. A refund that
  // leaked a byte would show up here before it showed up as a lost member block.
  assert.equal(w15.bytes, 2724, `after the leg, 8 types x 15 fields.${dump(w15)}`);
  assert.equal(b15.bytes, 2724, `before the leg, the same 8 x 15.${dump(b15)}`);
  assert.equal(w15.text, b15.text, `and the two prompts are byte-identical, not merely the same length.${dump(w15)}`);

  // 20 fields is where the aggregate has real surplus to spend, because the
  // member half alone no longer fits and only six member blocks are priced.
  const b20 = await measure(csFixture, 20, "other");
  const w20 = await measure(csFixture, 20, "field");
  assert.deepEqual(w20.shaped, ["Alpha", "Bravo"], `2 of 8 get a shape block at 20 fields.${dump(w20)}`);
  assert.deepEqual(w20.starved, ["Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"], `the tail six are shape-starved.${dump(w20)}`);
  assert.deepEqual(w20.membered, b20.membered, `and the member blocks are exactly the ones the pre-leg render had.${dump(w20)}`);
  // The two empty-handed types were empty-handed BEFORE the leg: eight member
  // blocks of 354 chars do not fit 2400. This is the aggregate binding on the
  // member half, which it did before this session, and not a starve.
  assert.deepEqual(w20.neither, ["Golfs", "Hotel"], `two types carry no block at all at this width.${dump(w20)}`);
  assert.deepEqual(b20.neither, w20.neither, `and the pre-leg render left exactly the same two with nothing.${dump(b20)}`);

  // The S39-1 shape - the ROOT gutted while later types render in full - still
  // does not land. The budget is spent in priority order, and a walk that cannot
  // print a complete def is refused rather than shipped as a stub.
  assert.equal(w20.fieldsIn("Alpha"), 20, `the highest-priority type's def survives WHOLE.${dump(w20)}`);
  assert.equal(/\.\.\.\s+\d+\s+more fields/.test(w20.text), false, `and nothing rendered is a truncated stub.${dump(w20)}`);

  // 30 fields: back to no shape block anywhere, and back to the pre-leg prompt.
  const b30 = await measure(csFixture, 30, "other");
  const w30 = await measure(csFixture, 30, "field");
  assert.deepEqual(w30.shaped, [], `no shape block is affordable at 30 fields.${dump(w30)}`);
  assert.deepEqual(w30.membered, b30.membered, `the member blocks are the pre-leg render's, unchanged.${dump(w30)}`);
  assert.equal(w30.bytes, 2742, `after the leg, 8 types x 30 fields.${dump(w30)}`);
  assert.equal(w30.text, b30.text, `and this prompt is byte-identical to the pre-leg one too.${dump(w30)}`);
});

btest("P4-4 [python]: starvation is REACHABLE - 8 types x 25 fields starves two, 8 x 30 starves three", async () => {
  const w20 = await measure(pyFixture, 20, "field");
  assert.deepEqual(w20.shaped, NAMES, `20 fields x 8 types still fits; this is the last width that does.${dump(w20)}`);

  const w25 = await measure(pyFixture, 25, "field");
  assert.deepEqual(w25.starved, ["Golfs", "Hotel"], `two types get no shape block at 25 fields, and they are the TAIL.${dump(w25)}`);

  const w30 = await measure(pyFixture, 30, "field");
  assert.deepEqual(w30.shaped, ["Alpha", "Bravo", "Chart", "Delta", "Echos"], `5 of 8 get a shape block at 30 fields.${dump(w30)}`);
  assert.deepEqual(w30.starved, ["Foxes", "Golfs", "Hotel"], `the tail three are starved.${dump(w30)}`);

  assert.equal(w30.fieldsIn("Alpha"), 30, `the highest-priority type's def survives WHOLE.${dump(w30)}`);
  assert.equal(/\.\.\.\s+\d+\s+more fields/.test(w30.text), false, `and nothing rendered is a truncated stub.${dump(w30)}`);
});

// ===========================================================================
// P4-5 / P4-6 / P4-7. WHEN A TYPE IS STARVED, IS IT DISCLOSED, AND DOES IT KEEP
// ITS FULL MEMBER BLOCK? This is the human's R2 ruling, verbatim: "starvation
// must be DISCLOSED. A SILENT starve is the defect, not the starve."
// ===========================================================================

btest("P4-5 [python]: MATCHES GO - every starved type is named twice, and every starved type keeps its FULL member block", async () => {
  const w30 = await measure(pyFixture, 30, "field");
  assert.equal(w30.starved.length, 3, `precondition: this width starves.${dump(w30)}`);

  // NAMED ONCE: its own walk's drop line.
  const dropLines = w30.logs.filter((l) => /dropped/.test(l));
  for (const n of w30.starved) {
    assert.ok(
      dropLines.some((l) => l.includes(n)),
      `\`${n}\` lost its data shape and nothing on the channel says so.${dump(w30)}`,
    );
  }
  // NAMED TWICE: the aggregate line, with the count, the names and the way out.
  const agg = w30.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(agg, `an aggregate accounting line must name the starve.\nLOGS:\n${w30.logs.join("\n")}`);
  for (const n of w30.starved) assert.ok(agg.includes(n), `the aggregate line names \`${n}\`.\nLINE: ${agg}`);
  assert.match(agg, /column80\.injectedContext/, `and it names the setting that buys the shape back.\nLINE: ${agg}`);

  // AND THE MEMBER LIST IS NEVER WHAT IS LOST - the guard that makes shipping
  // this leg strictly better than not shipping it.
  assert.deepEqual(w30.membered, NAMES, `every type keeps a member block, starved or not.${dump(w30)}`);
  for (const n of w30.starved) {
    // A member line is written bare, at column 0; the shape block indents its
    // fields. Two spellings of the same field, and the row must count the
    // MEMBER one.
    const sec = sectionOf(w30.text, "Members of", n) || "";
    assert.equal(sec.split("\n").filter((l) => /^fa\d\d: /.test(l)).length, 30, `a starved type keeps its FULL member list.${dump(w30)}`);
    assert.ok(sec.includes("settle(self, amount: int) -> bool"), `including its methods.${dump(w30)}`);
  }
  assert.equal(w30.disclosed.length, 8, `and all eight are still reported as disclosed.${dump(w30)}`);

  // "FULL" SPELLED AS BYTES, which also validates the instrument: a starved
  // type sheds nothing, so its member block must be byte-identical to the one
  // the pre-leg render produced. If the kind flip changed anything other than
  // the field derivation, these two strings would differ.
  const b30 = await measure(pyFixture, 30, "other");
  for (const n of w30.starved) {
    assert.equal(
      sectionOf(w30.text, "Members of", n),
      sectionOf(b30.text, "Members of", n),
      `a starved type's member block is byte-identical to the pre-leg one.${dump(w30)}`,
    );
  }
});

// P4-6 KEEPS ITS QUESTION - is every loss disclosed - and RE-CUTS ITS ANSWER,
// for two reasons, both of them session-v51 phase 0's doing. The channel gained
// a word: a walk refused by the member floor logs `refused`, not `dropped`, and
// a row matching only v50's vocabulary would pass a silent starve. And the set
// under measurement changed: at 30 fields no type renders a shape block now, so
// every one of the eight is a loss to disclose, where v50 measured five.
btest("P4-6 [csharp]: every C# type that loses surface IS named on the channel - the starve is not silent", async () => {
  const b30 = await measure(csFixture, 30, "other");
  const w30 = await measure(csFixture, 30, "field");
  const lost = NAMES.filter((n) => !w30.shaped.includes(n) || !w30.membered.includes(n));
  assert.deepEqual(lost, NAMES, `precondition: at this width every type loses surface it could have had.${dump(w30)}`);
  for (const n of lost) {
    assert.ok(
      w30.logs.some((l) => l.includes(`\`${n}\``) && /dropped|exhausted|injected nothing|refused/.test(l)),
      `\`${n}\` lost surface and nothing on the channel says so. A silent starve is the defect the ruling forbids.${dump(w30)}`,
    );
  }
  const agg = w30.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(agg, `an aggregate accounting line must name the starve.\nLOGS:\n${w30.logs.join("\n")}`);
  for (const n of w30.starved) assert.ok(agg.includes(n), `the aggregate line names every SHAPE-starved type.\nLINE: ${agg}`);
  assert.match(agg, /column80\.injectedContext/, `and names the setting that buys them back.\nLINE: ${agg}`);
  // THE CAUSE IS NAMED, not just the type. Five of the eight lost their shape to
  // the member floor and three to the aggregate running out, and the ledger says
  // which is which, so a developer can tell "raise the setting" from "the member
  // lists already have it".
  assert.match(agg, /member lists hold the rest of the budget/, `the floor's own drop cause reaches the aggregate line.\nLINE: ${agg}`);
  assert.match(agg, /render budget 0 tok left of the prompt's shared aggregate/, `and so does the plain budget cause.\nLINE: ${agg}`);

  // THE v50 ASYMMETRY IS GONE, and this is what closes it rather than papers
  // over it. v50 recorded that `Delta` kept a shape block, lost its MEMBER block,
  // and that the aggregate ledger could not carry that loss because it counts
  // types dropped entirely. Under the member floor there is no member-only loss
  // to carry, at this width or any other, so the ledger is complete again.
  assert.deepEqual(
    b30.membered.filter((n) => !w30.membered.includes(n)),
    [],
    `no type suffers a member-only loss, so nothing falls through the aggregate ledger.${dump(w30)}`,
  );

  // THE MIXED WIDTH, where both causes fire and two types are not losses at all.
  const w20 = await measure(csFixture, 20, "field");
  const agg20 = w20.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(agg20, `an aggregate accounting line at 20 fields too.\nLOGS:\n${w20.logs.join("\n")}`);
  for (const n of w20.starved) assert.ok(agg20.includes(n), `the aggregate line names \`${n}\`.\nLINE: ${agg20}`);
  for (const n of w20.shaped) {
    assert.equal(agg20.includes(n), false, `\`${n}\` rendered both blocks and must not be reported as dropped.\nLINE: ${agg20}`);
  }
});

// P4-7 WAS RED ON PURPOSE FOR A SESSION AND IS NOW GREEN. Its name and its
// failure message are v50's, kept verbatim rather than reworded, because it is
// the ship condition session-v51 phase 0 was written against and a diff of it
// should show nothing. Read the name as the question it asks, not as a claim
// about today's build: it passes, so the answer is that a starved C# type DOES
// keep its member block.
//
// WHAT WAS WRONG, and it is worth keeping written down. C# member blocks render
// through `csShapeGraphBlock` with `budget = { remaining: sharedWalk.remainingChars }`,
// so they spend the SAME per-prompt aggregate the shape blocks spend, and the
// shape blocks spent it first. Go's member half never touches that budget and
// Python's does not either, which is why both of them held the guard and C# did
// not.
//
// WHAT FIXED IT. session-v51 phase 0: `resolvePrefill` prices the whole prompt's
// member blocks before the render loop starts and parks the total as a floor. A
// shape block may spend the surplus above that floor, plus what its own type's
// member block will shed once the shape block has printed those fields, and a
// walk that cannot repay what it spent is refused whole and refunded. The
// apportionment had to live in the caller: the aggregate is spent ACROSS ROOTS,
// so a reservation taken inside `csShapeBlock` arrives after earlier roots have
// already taken the budget, which is the version session-v50 built and reverted.
//
// THE MEASUREMENT, re-run on both sides 2026-08-11 after that change. 8 types,
// `small` stop, one method and N fields each:
//
//   fields/type | before: member blocks | after: shapes | after: member blocks
//   10          |                     8 |             8 |                    8
//   15          |                     8 |             0 |                    8
//   20          |                     6 |             2 |                    6
//   25          |                     5 |             2 |                    5
//   30          |                     5 |             0 |                    5
//
// The before and after member columns are equal at every width, which is the
// guard. What moved is the shape column, and it moved DOWN: at 15 and 30 fields
// no C# shape block renders at all where v50 rendered seven and four. That is
// the price of the floor and it is one-directional by design. The shape block is
// new surface; the member list is surface a developer already reads.
btest("P4-7 [csharp] DEFECT: a C# type starved of its data shape does NOT keep its member block - the guard Go and Python both hold", async () => {
  const before = await measure(csFixture, 15, "other");
  const after = await measure(csFixture, 15, "field");

  assert.deepEqual(before.membered, NAMES, `precondition: before the field leg, all eight types render a member block.${dump(before)}`);
  const lostMembers = before.membered.filter((n) => !after.membered.includes(n));

  assert.deepEqual(
    lostMembers,
    [],
    `THE DEFECT. 8 C# types x 15 fields: the pre-leg render gave all 8 their member block (${before.bytes} bytes); with the ` +
      `field leg lit, ${lostMembers.join(" and ")} lose theirs, and \`${after.neither.join(", ")}\` is left in the prompt with ` +
      `NEITHER a shape block nor a member block. The C# member blocks spend the same shared aggregate as the shape blocks ` +
      `(csShapeGraphBlock's \`budget = { remaining: sharedWalk.remainingChars }\`), so a shape block rendered for an earlier ` +
      `type buys itself with a later type's member list. Go's member half and Python's do not touch that budget, which is why ` +
      `the v49 ruling holds for both of them and not here. csShapeBlock's own comment states the guard this breaks: "no shape ` +
      `block for a type means its member list is byte-identical to today (a walk that resolved nothing must not cost a ` +
      `developer the list they have)".${dump(after)}`,
  );
});
