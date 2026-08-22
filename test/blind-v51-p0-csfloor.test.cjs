// BLIND ORACLE - session-v51 phase 0. THE C# MEMBER LIST IS THE FLOOR.
//
// Bound to that phase's contract, written before the implementation. Every row
// below points at a sentence in it. Nothing here imports
// `csShapeBlock`, `csShapeGraphBlock`, `walkDataShape` or any pricing helper:
// the contract bans it by name, because a row bound to a helper is what let
// Python's field leg sit dark for most of session-v50. The only thing driven is
// the facade, `resolvePrefill`, with a fake transport.
//
// THE INVARIANT, in the contract's words: "A member surface a developer had
// before the field leg is never what the leg costs them." It is spelled three
// ways, and each spelling gets its own row at each width:
//
//   1. block presence  - a type with a member block BEFORE has one AFTER;
//   2. no member LINE lost - every member the before side printed for a type is
//      somewhere in the after side's prompt for that type, member block or
//      shape block. The stronger reading, and the one that matters;
//   3. nothing at all - a type given a block before has at least one after.
//
// THE ONE VARIABLE, copied from `test/review-v50-p4-starvation.test.cjs`: the
// `kind` the transport puts on a data member. `other` is the pre-leg input
// verbatim (no field derivation, so no shape block); `field` is the post-leg
// input; `renderMemberSignatures` ignores kind, so the member LINES are
// byte-identical across the flip. Product render on both sides.
//
// WHAT IS ALLOWED TO GIVE is the data-shape block, and only if it is disclosed
// twice - own drop line and aggregate line. Fewer shape blocks at 15 and 30
// fields is the arithmetic of the guard, not a defect, so no row here reads a
// missing shape block as a regression on its own.
//
// GO AND PYTHON MUST NOT MOVE. Their member halves are rendered outside this
// aggregate, so their member blocks at a starving width are pinned here, in
// bytes, as the tripwire for a fix that reaches further than C#.
//
// Run: SKIP_LIVE=1 npx node --test test/blind-v51-p0-csfloor.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v51-p0-vscode-stub.cjs");
const ENTRY = path.join(__dirname, ".blind-v51-p0.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v51-p0.bundle.cjs");

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
      const files = globalThis.__V51P0_FILES__ || {};
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
// THE FIXTURES. Eight types, one method each, N data members each, every type
// named in the target's own signature so all eight are candidates in a fixed
// priority order. Field TYPES are lowercase scalars on purpose: the candidate
// scan is PascalCase, so no field opens a collaborator edge and the only thing
// under measurement is the shared budget.
// ===========================================================================

const NAMES = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"];
const WIDTHS = [1, 10, 15, 20, 25, 30];

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
const goField = (i) => `Fld${String(i).padStart(2, "0")}`;

// A distinct uri per run. resolvePrefill leaves background work in flight, and
// two runs sharing one uri would let a straggler read a later run's source.
const uriFor = (lang, fieldCount, kind) => `file:///w/v51p0/${lang}-${fieldCount}-${kind}`;

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

// GO. The flip is not `kind` here: Go's data shape comes off the HOVER, so the
// pre-leg input is gopls's head-only hover (`type Alpha struct`, nothing
// walkable) and the post-leg input is the same hover carrying the struct body.
// That is v49's FIX_HEADONLY/FIX_BODY pair, widened to eight types.
//
// The members are METHODS ONLY, deliberately. Go sheds from the member list
// exactly the fields the shape block rendered, so a field member would make the
// two sides differ for a legitimate reason and destroy the byte comparison. With
// methods only, nothing is ever shed and the member blocks MUST be identical
// across the flip - unless Go's member half is spending the shape aggregate,
// which is the thing this row exists to catch.
const GO_METHODS = 12;
function goFixture(fieldCount, kind) {
  const uri = uriFor("go", fieldCount, kind) + "/app.go";
  const body = (n) =>
    [`type ${n} struct {`]
      .concat(Array.from({ length: fieldCount }, (_, i) => `\t${goField(i)} ${i % 2 ? "int" : "string"}`))
      .concat(["}"])
      .join("\n");
  const methodsOf = (n) =>
    Array.from({ length: GO_METHODS }, (_, i) => ({
      name: `Settle${String(i).padStart(2, "0")}`,
      kind: "method",
      signature: `func (r *${n}) Settle${String(i).padStart(2, "0")}(ctx context.Context, amount int64) (int64, error)`,
    }));
  const members = {};
  const hovers = {};
  for (const n of NAMES) {
    members[n] = methodsOf(n);
    hovers[n] = kind === "field" ? body(n) : `type ${n} struct`;
  }
  const doc = ["// Rebuild rewrites the registry.", `// It works with ${NAMES.map((n) => "`" + n + "`").join(", ")}.`].join("\n");
  const src = ["package app", ""]
    .concat(NAMES.map((n) => body(n)))
    .concat(["", doc, "func Rebuild() error {", '\tpanic("todo")', "}", ""])
    .join("\n");
  return {
    uri,
    src,
    members,
    hovers,
    declRe: (t) => new RegExp(`^type ${t} struct`),
    record: {
      span: { start: src.indexOf("func Rebuild"), end: src.length - 2 },
      signature: "func Rebuild() error",
      docComment: doc,
      symbolName: "Rebuild",
      languageId: "go",
      kind: "function",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "\t",
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

// The lines inside a section's fence, header and fences stripped.
const bodyLines = (section) =>
  String(section || "")
    .split("\n")
    .filter((l) => !/^```/.test(l) && !/^(Members|Data shape) of `/.test(l) && l.trim().length > 0);

// The identifier a member line leads with. `Fa00 : string` -> Fa00,
// `Settle(int) : bool` -> Settle, `func (r *Alpha) Settle00(...)` -> Settle00.
const leadName = (line) => {
  const s = String(line).trim();
  const recv = /^func\s+\([^)]*\)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
  if (recv) return recv[1];
  const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(s);
  return m ? m[1] : undefined;
};

// Does this section mention `name` as the thing a line is ABOUT? A shape block
// renders a field indented and spelled its own way, so the contract's "appears
// somewhere in the after side's prompt for that type" cannot be a byte match.
const mentions = (section, name) =>
  bodyLines(section).some((l) => new RegExp(`^${name}\\b`).test(l.trim()));

/** One render, through the product. For C# and Python `kind` is the only
 *  variable between the before side (`other`, the pre-leg transport) and the
 *  after side (`field`); for Go it selects the head-only vs body hover. */
const CACHE = new Map();
async function measure(make, fieldCount, kind) {
  const key = `${make.name}|${fieldCount}|${kind}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const fix = make(fieldCount, kind);
  const logs = [];
  const disclosed = [];
  // MERGED, never deleted: a straggler that finds the file map gone reports as
  // an unhandled rejection after the row that started it has ended.
  globalThis.__V51P0_FILES__ = { ...(globalThis.__V51P0_FILES__ || {}), [fix.uri]: fix.src };
  const text =
    (await FN.resolvePrefill(extractorFor(fix), makeDoc(fix.src, fix.uri), fix.record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)),
    })) || "";
  const shaped = NAMES.filter((n) => text.includes(`Data shape of \`${n}\``));
  const membered = NAMES.filter((n) => text.includes(`Members of \`${n}\``));
  const r = {
    fix,
    fieldCount,
    kind,
    text,
    logs,
    disclosed,
    bytes: B(text),
    shaped,
    membered,
    shapeStarved: NAMES.filter((n) => !shaped.includes(n)),
    neither: NAMES.filter((n) => !shaped.includes(n) && !membered.includes(n)),
    memberSection: (n) => sectionOf(text, "Members of", n),
    shapeSection: (n) => sectionOf(text, "Data shape of", n),
    memberNames: (n) => bodyLines(sectionOf(text, "Members of", n)).map(leadName).filter(Boolean),
  };
  CACHE.set(key, r);
  return r;
}

const dump = (m) =>
  `\n[${m.fix.record.languageId} ${m.fieldCount} fields, kind=${m.kind}, ${m.bytes}B]` +
  `\nSHAPED: ${m.shaped.join(",") || "-"}\nMEMBERS: ${m.membered.join(",") || "-"}` +
  `\nLOGS:\n${m.logs.join("\n") || "(silent)"}\nPROMPT:\n${m.text || "(empty)"}`;

const dump2 = (before, after) => `\n=== BEFORE ===${dump(before)}\n=== AFTER ===${dump(after)}`;

// ===========================================================================
// G0. THE GUARD. Every bound is the product's own, read off its profile
// builder. The contract forbids re-deriving one.
// ===========================================================================

btest("G0 guard: the bundle builds and the budget under measurement is read from the product's own budgetProfileFor", () => {
  assert.equal(typeof FN.resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
  assert.equal(typeof FN.budgetProfileFor, "function", "budgetProfileFor must be exported from src/core/budgetProfile");
  const p = FN.budgetProfileFor("local-mid", "csharp", FN.DEFAULT_CONTEXT_STOP);
  assert.equal(p.stop, "small", "the contract measures the install default stop");
  assert.ok(Number.isFinite(p.surfaceBudgetTok), `the shared aggregate must be a number; got ${p.surfaceBudgetTok}`);
  assert.equal(p.rootCap, 8, "eight roots, so the fixture's eight types all get a slot and only the BUDGET can bind");
  assert.equal(p.memberCap, 48, "48 members per type, so 30 fields plus a method never trips the member cap");
  // Stated so a later reader can see WHICH number the rows below are pressing
  // against without any row re-deriving it.
  assert.equal(
    p.surfaceBudgetTok * 4,
    2400,
    `the contract's per-prompt character aggregate is surfaceBudgetTok * 4; the profile says ` +
      `${p.surfaceBudgetTok} tok. If this moved, every width in this file needs re-measuring, not adjusting.`,
  );
});

// ===========================================================================
// A0. THE ANCHOR. A row that cannot produce the case it measures has not
// measured it. Before any invariant row runs, prove the fixture reaches the
// interesting regime: all eight member blocks on the BEFORE side at 15 fields,
// and an aggregate that actually binds at 30.
// ===========================================================================

btest("A0 anchor: the fixture reaches the regime - all eight member blocks BEFORE at 15 fields, and the aggregate really binds at 30", async () => {
  const b15 = await measure(csFixture, 15, "other");
  assert.deepEqual(
    b15.membered,
    NAMES,
    `PRECONDITION. If the pre-leg render does not give all eight types a member block, then "the member ` +
      `surface a developer had before the leg" is not eight blocks and every invariant row below is measuring ` +
      `a smaller claim than it says.${dump(b15)}`,
  );
  assert.deepEqual(b15.shaped, [], `PRECONDITION: kind=other is the pre-leg input, so no data-shape block may exist on the BEFORE side.${dump(b15)}`);
  assert.deepEqual(b15.disclosed, NAMES, `PRECONDITION: all eight types are admitted as candidates, so a lost block is a budget event and not an admission one.${dump(b15)}`);

  const a30 = await measure(csFixture, 30, "field");
  assert.ok(
    a30.shaped.length < NAMES.length,
    `PRECONDITION. 8 types x 30 fields must EXHAUST the shared aggregate; it rendered ${a30.shaped.length} of ` +
      `${NAMES.length} shape blocks, so the starvation rows below would be asserting on a case that never ` +
      `fires. Widen the fixture rather than re-cutting the rows.${dump(a30)}`,
  );

  // And the flip is one variable, not two: the member LINES are the same on
  // both sides at a width where nothing is starved. If this fails, the before
  // column is not the pre-leg render and no comparison in this file is valid.
  const b1 = await measure(csFixture, 1, "other");
  const a1 = await measure(csFixture, 1, "field");
  assert.deepEqual(a1.membered, NAMES, `CONTROL: at one field per type nothing can be starved.${dump(a1)}`);
  for (const n of NAMES) {
    assert.deepEqual(
      a1.memberNames(n).filter((x) => x !== csField(0)),
      b1.memberNames(n).filter((x) => x !== csField(0)),
      `INSTRUMENT: apart from the field the shape block sheds, \`${n}\`'s member lines must be identical across ` +
        `the kind flip. renderMemberSignatures ignores kind; if these differ, the flip changed something else too.` +
        `${dump2(b1, a1)}`,
    );
  }
});

// ===========================================================================
// I1. INVARIANT 1 - BLOCK PRESENCE. "Every type that renders a `Members of X`
// block on the BEFORE side renders one on the AFTER side."
// ===========================================================================

for (const w of WIDTHS) {
  btest(`I1 [csharp, ${w} fields]: every type with a member block before the field leg still has one after it`, async () => {
    const before = await measure(csFixture, w, "other");
    const after = await measure(csFixture, w, "field");
    assert.ok(before.membered.length > 0, `PRECONDITION: the before side must render member blocks at all.${dump(before)}`);
    const lost = before.membered.filter((n) => !after.membered.includes(n));
    assert.deepEqual(
      lost,
      [],
      `${w} fields x 8 types: the pre-leg render gave ${before.membered.length} member block(s) ` +
        `(${before.bytes}B); with the field leg lit, ${lost.join(", ")} lose theirs (${after.bytes}B, ` +
        `${after.membered.length} member block(s), ${after.shaped.length} shape block(s)). The contract: "A member ` +
        `surface a developer had before the field leg is never what the leg costs them."${dump2(before, after)}`,
    );
  });
}

// ===========================================================================
// I2. INVARIANT 2 - NO MEMBER LINE IS LOST FROM THE PROMPT. The stronger
// reading, and the one that matters: a type whose members are ALL fields may
// legitimately move its whole member block into the shape block, which
// invariant 1 would call a loss and this one would not.
//
// THE CALL THIS ROW MAKES: a shape block spells a field its own way, so
// "appears somewhere in the after side's prompt for that type" is matched on
// the member's NAME leading a line inside that type's own sections, not on the
// byte-identical member line. A byte match would fail on the legitimate move
// the contract explicitly permits.
// ===========================================================================

for (const w of WIDTHS) {
  btest(`I2 [csharp, ${w} fields] THE ROW THAT MATTERS: no member the before side printed is missing from the after side's prompt`, async () => {
    const before = await measure(csFixture, w, "other");
    const after = await measure(csFixture, w, "field");

    const missing = [];
    for (const n of NAMES) {
      const had = before.memberNames(n);
      if (had.length === 0) continue;
      const mem = after.memberSection(n);
      const shp = after.shapeSection(n);
      for (const name of had) if (!mentions(mem, name) && !mentions(shp, name)) missing.push(`${n}.${name}`);
    }
    const summary = missing.length > 25 ? `${missing.slice(0, 25).join(", ")} ... and ${missing.length - 25} more` : missing.join(", ");
    assert.equal(
      missing.length,
      0,
      `${w} fields x 8 types: ${missing.length} member(s) the pre-leg prompt carried are in NEITHER the after ` +
        `side's member block NOR its data-shape block. Missing: ${summary}. This is the loss the contract ` +
        `forbids outright - the shape block is what gives, never the member surface.${dump2(before, after)}`,
    );
  });
}

// ===========================================================================
// I3. INVARIANT 3 - NO TYPE ENDS UP WITH NOTHING. "A type admitted as a
// candidate on the before side and given a block there has at least one block
// on the after side."
// ===========================================================================

for (const w of WIDTHS) {
  btest(`I3 [csharp, ${w} fields]: no type is left in the prompt with neither a member block nor a data-shape block`, async () => {
    const before = await measure(csFixture, w, "other");
    const after = await measure(csFixture, w, "field");
    const hadBlock = NAMES.filter((n) => before.membered.includes(n) || before.shaped.includes(n));
    assert.ok(hadBlock.length > 0, `PRECONDITION: the before side must give some type a block.${dump(before)}`);
    const emptied = hadBlock.filter((n) => after.neither.includes(n));
    assert.deepEqual(
      emptied,
      [],
      `${w} fields x 8 types: ${emptied.join(", ")} had a block before the field leg and now sit in the prompt ` +
        `with nothing at all. A type named in the target's own signature, admitted as a candidate, and given ` +
        `neither block is the worst form of the trade the contract forbids.${dump2(before, after)}`,
    );
  });
}

// ===========================================================================
// D1. DISCLOSURE. The shape block IS allowed to give. What is not allowed is
// giving it quietly: a type that loses its shape block is named twice - on its
// own walk's drop line and on the per-gesture aggregate line that also names
// `column80.injectedContext`. Session-v42's R2 ruling, unchanged.
// ===========================================================================

for (const w of [15, 30]) {
  btest(`D1 [csharp, ${w} fields]: a type that loses its data-shape block is named on its own drop line AND on the injectedContext aggregate line`, async () => {
    const before = await measure(csFixture, w, "other");
    const after = await measure(csFixture, w, "field");
    const lostShape = after.shapeStarved.filter((n) => before.membered.includes(n) || before.shaped.includes(n));
    assert.ok(
      lostShape.length > 0,
      `PRECONDITION. At ${w} fields nothing loses a shape block, so this row has no subject and proves nothing ` +
        `about disclosure. Widen the fixture; do not weaken the row.${dump(after)}`,
    );

    // NAMED ONCE: its own walk's drop line.
    const dropLines = after.logs.filter((l) => /dropped|exhausted|injected nothing/.test(l));
    for (const n of lostShape) {
      assert.ok(
        dropLines.some((l) => l.includes(n)),
        `\`${n}\` lost its data-shape block and no per-walk line on the channel says so. A silent starve is the ` +
          `defect, not the starve.${dump(after)}`,
      );
    }

    // NAMED TWICE: the aggregate line, with the names and the way out.
    const agg = after.logs.find((l) => /injected context dropped/.test(l));
    assert.ok(agg, `the per-gesture aggregate accounting line is missing entirely.${dump(after)}`);
    const unnamed = lostShape.filter((n) => !agg.includes(n));
    assert.deepEqual(
      unnamed,
      [],
      `the aggregate line must name every type that lost its shape block; ${unnamed.join(", ")} is missing from ` +
        `it. A developer reads this one line.\nLINE: ${agg}${dump(after)}`,
    );
    assert.match(agg, /column80\.injectedContext/, `and it names the setting that buys the shape back.\nLINE: ${agg}`);
  });
}

// ===========================================================================
// X1 / X2. OUT OF SCOPE, PINNED. "Go, Python, Rust and TypeScript render no
// member block out of this aggregate. Their behaviour must not move by a byte."
// Both rows run at a width where the shape aggregate is genuinely starving, so
// a fix that reaches past C# into the shared apportionment lands here first.
// ===========================================================================

btest("X1 [python]: the C# apportionment must not touch Python - every member block survives a starving width, byte for byte", async () => {
  const before = await measure(pyFixture, 30, "other");
  const after = await measure(pyFixture, 30, "field");
  assert.ok(
    after.shapeStarved.length > 0,
    `PRECONDITION: 8 Python types x 30 fields must starve some shape block, or this row is not measuring the ` +
      `case it claims.${dump(after)}`,
  );
  assert.deepEqual(after.membered, NAMES, `every Python type keeps a member block, starved or not.${dump(after)}`);
  assert.deepEqual(before.membered, NAMES, `and had one before the leg.${dump(before)}`);
  for (const n of after.shapeStarved) {
    assert.equal(
      after.memberSection(n),
      before.memberSection(n),
      `\`${n}\` is starved of its shape block, so it sheds nothing and its member block must be byte-identical ` +
        `to the pre-leg one. Python's member half does not come out of this aggregate.${dump2(before, after)}`,
    );
  }
  // Every member line still on the prompt somewhere, the same invariant 2 C#
  // owes. Python passes it today; a C# fix must leave that alone.
  for (const n of NAMES) {
    for (const name of before.memberNames(n)) {
      assert.ok(
        mentions(after.memberSection(n), name) || mentions(after.shapeSection(n), name),
        `Python lost \`${n}.${name}\` from the whole prompt. This row is out of scope for phase 0 - if it goes ` +
          `red, the C# fix reached further than C#.${dump2(before, after)}`,
      );
    }
  }
});

btest("X2 [go]: the C# apportionment must not touch Go - method blocks are byte-identical across the field leg at a starving width", async () => {
  const before = await measure(goFixture, 30, "other");
  const after = await measure(goFixture, 30, "field");
  assert.deepEqual(
    before.shaped,
    [],
    `PRECONDITION: the head-only hover (\`type X struct\`) is Go's pre-leg input and nothing is walkable from ` +
      `it, so no shape block may render on the before side.${dump(before)}`,
  );
  assert.ok(
    after.shaped.length > 0 && after.shapeStarved.length > 0,
    `PRECONDITION: 8 Go structs x 30 fields must render SOME shape blocks and starve others (got ` +
      `${after.shaped.length} shaped, ${after.shapeStarved.length} starved), or the row is not at the ` +
      `starvation regime it claims.${dump(after)}`,
  );
  assert.deepEqual(after.membered, NAMES, `every Go type keeps its member block at a starving width.${dump(after)}`);
  // This fixture's members are methods only, so Go's field shed cannot apply
  // and the two sides must be identical everywhere, not only on starved types.
  for (const n of NAMES) {
    assert.equal(
      after.memberSection(n),
      before.memberSection(n),
      `\`${n}\`'s Go member block moved across the field leg. It is 12 methods and no fields, so nothing is ` +
        `legitimately shed: a difference means Go's member half is spending the shape aggregate.${dump2(before, after)}`,
    );
  }
});
