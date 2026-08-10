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
// MEASURED 2026-08-11, 8 types, `small` stop (the install default), aggregate
// budget 600 tok, member cap 48, root cap 8:
//
//   C#           | before | after | shapes | member blocks | neither
//   1 field      |   1324 |  2004 |      8 |             8 |       0
//   10 fields    |   2212 |  3180 |      8 |             8 |       0
//   15 fields    |   2724 |  3191 |      7 |             6 |       1
//   30 fields    |   2742 |  2950 |      4 |             3 |       4
//
//   Python       | before | after | shapes | member blocks | neither
//   1 field      |   1448 |  2104 |      8 |             8 |       0
//   10 fields    |   2168 |  3112 |      8 |             8 |       0
//   25 fields    |   3368 |  4436 |      6 |             8 |       0
//   30 fields    |   3768 |  4758 |      5 |             8 |       0
//
// THE VERDICT, per language, is in the rows below. Python matches Go: starvation
// is reachable at 25 fields x 8 types, every starved type is named twice, and
// every starved type keeps its FULL member block. C# does not: from 15 fields x
// 8 types it loses member blocks the pre-leg render delivered, and past 25 it
// hands whole types NEITHER block. That is a defect against the product's own
// stated guard, and P4-7 is RED with the evidence.
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

btest("P4-3 [csharp]: starvation is REACHABLE - 8 types x 15 fields already leaves one type with nothing, and 8 x 30 leaves four", async () => {
  const w15 = await measure(csFixture, 15, "field");
  assert.equal(w15.shaped.length, 7, `7 of 8 types get a shape block at 15 fields.${dump(w15)}`);
  assert.deepEqual(w15.starved, ["Hotel"], `the starve falls on the TAIL, in priority order.${dump(w15)}`);
  assert.deepEqual(w15.neither, ["Hotel"], `and at this width one type is already in the prompt with neither block.${dump(w15)}`);

  const w30 = await measure(csFixture, 30, "field");
  assert.deepEqual(w30.shaped, ["Alpha", "Bravo", "Chart", "Delta"], `4 of 8 get a shape block at 30 fields.${dump(w30)}`);
  assert.deepEqual(w30.starved, ["Echos", "Foxes", "Golfs", "Hotel"], `the tail four are starved.${dump(w30)}`);

  // The S39-1 shape - the ROOT gutted while later types render in full - still
  // does not land. The budget is spent in priority order.
  assert.equal(w30.fieldsIn("Alpha"), 30, `the highest-priority type's def survives WHOLE.${dump(w30)}`);
  assert.equal(/\.\.\.\s+\d+\s+more fields/.test(w30.text), false, `and nothing rendered is a truncated stub.${dump(w30)}`);
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

btest("P4-6 [csharp]: every C# type that loses surface IS named on the channel - the starve is not silent", async () => {
  const w30 = await measure(csFixture, 30, "field");
  const lost = NAMES.filter((n) => !w30.shaped.includes(n) || !w30.membered.includes(n));
  assert.deepEqual(lost, ["Delta", "Echos", "Foxes", "Golfs", "Hotel"], `precondition: five types lose surface at this width.${dump(w30)}`);
  for (const n of lost) {
    assert.ok(
      w30.logs.some((l) => l.includes(`\`${n}\``) && /dropped|exhausted|injected nothing/.test(l)),
      `\`${n}\` lost surface and nothing on the channel says so. A silent starve is the defect the ruling forbids.${dump(w30)}`,
    );
  }
  const agg = w30.logs.find((l) => /injected context dropped/.test(l));
  assert.ok(agg, `an aggregate accounting line must name the starve.\nLOGS:\n${w30.logs.join("\n")}`);
  for (const n of w30.starved) assert.ok(agg.includes(n), `the aggregate line names every SHAPE-starved type.\nLINE: ${agg}`);
  assert.match(agg, /column80\.injectedContext/, `and names the setting that buys them back.\nLINE: ${agg}`);
  // The disclosure asymmetry against Python and Go, recorded here rather than
  // asserted as the defect: `Delta` keeps a shape block and loses its MEMBER
  // block, and that loss appears only on the per-block line. The aggregate
  // ledger counts types dropped ENTIRELY, so it does not carry it, and a
  // developer reading the one summary line is told four types were dropped when
  // five lost surface.
  assert.equal(agg.includes("Delta"), false, `recorded, not asserted as the defect: the aggregate line does not carry a member-only loss.\nLINE: ${agg}`);
});

// P4-7 IS RED ON PURPOSE. It is a defect claim with its evidence, not a
// regression in this file.
//
// WHAT IS WRONG. `csShapeBlock`'s own doc comment states the guard it inherited
// from Go, in these words: "no shape block for a type means its member list is
// byte-identical to today (a walk that resolved nothing must not cost a
// developer the list they have)". The C# member blocks are rendered through
// `csShapeGraphBlock` with `budget = { remaining: sharedWalk.remainingChars }`,
// so they spend the SAME aggregate the shape blocks now spend first. Go's
// member half never touches that budget and Python's does not either, which is
// why both of them keep the guard and C# does not.
//
// THE MEASUREMENT. 8 types, `small` stop, one method and N fields each:
//
//   fields/type | before: member blocks | after: shapes | after: member blocks
//   10          |                     8 |             8 |                    8
//   15          |                     8 |             7 |                    6
//   20          |                     6 |             6 |                    5
//   30          |                     5 |             4 |                    3
//
// At 15 fields the pre-leg render gave all eight types their member list and the
// post-leg render gives six. `Hotel` is starved of its shape AND stripped of the
// member block it had before, so it sits in the prompt with nothing at all. That
// is the exact trade the ruling forbids: the member list a developer has today
// is the thing that is lost.
//
// It is not the fixture being extreme. The knee moved: C#'s member blocks were
// already budget-bound before this session, from 20 fields x 8 types, and the
// shape blocks moved that wall down to 15.
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
