// BLIND CONTRACT ORACLE - session-v37 item 2, "give each language its own
// bounds, values unchanged". Written from `session-v37/goal.md` and the declared
// facade only. `src/vscode/fnGen.ts` was never read while writing this file.
//
// THE CONTRACT. Three numbers bound the pre-fill injection and today all three
// are module constants shared by five languages:
//
//   PREFILL_TYPE_CAP = 4        how many candidates may be INJECTED (prompt bytes)
//   PREFILL_RESOLVE_CAP = 8     how many may be RESOLVED (one LS round trip each)
//   PREFILL_PROVENANCE_CAP = 24 how many may be PROVENANCE-CHECKED (definition lookups)
//
// Item 2 moves all three onto the existing per-language `PrefillLang` seam with
// EVERY language's value unchanged at 4, 8 and 24, as `typeCap`, `resolveCap`
// and `provenanceCap`. A no-op by construction, which is the point: it is what
// lets item 3 move one language's number without touching the other four.
//
// THE FAILURE THIS FILE EXISTS TO CATCH. A refactor that reads the per-language
// value in one place and the module constant in another ships green with a
// decorative seam. Section B is that row: it moves rust's `typeCap` on the real
// table and demands the injected count move with it.
//
// EXPECTED RED AT THE TIME OF WRITING. The feature is unbuilt, so all ten rows
// that name a bound member fail: the five `A [lang]` rows, A7, B1, B2, C1 and
// C2. The three that pass today are the bundle guard, A6 (the five entries are
// five distinct objects) and D1 (the observed budget is 4 in all five). D1
// passing now is correct - it is the no-op half of the acceptance and must stay
// green through the refactor.
//
// BYTE IDENTITY IS NOT HERE, AND CANNOT BE. The acceptance asks for prompt bytes
// identical before and after. A test written after the fact has no "before" to
// compare against, and a file that pretended otherwise would be theatre. Byte
// identity is carried by the EXISTING frozen oracles, which must stay green
// across item 2 and are the real gate:
//
//   test/blind-v7-prepare.test.cjs        "P3: named/local A and T survive the budget"
//   test/blind-v24-p1-receiver.test.cjs   "item 12 [rust]: the receiver takes the first
//                                          slot of the EXISTING cap" and "item 17 [rust]:
//                                          no cap constant moves"
//   test/impl-v24-p1-receiver.test.cjs    "prompt-size: the CAP arm"
//
// Those four are the rows the goal's regression section measured as the only
// rows in 7058 that move when the cap value changes. This file does NOT duplicate
// them. It pins what they do not: that the budget is 4 in ALL FIVE languages, not
// just Rust, so a value change in any one language surfaces here as well as there.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PIN. `resolveCap` and `provenanceCap`
// spend latency, not bytes, and there is no honest black-box lever on them from
// a headless harness. They are pinned structurally, by value and by relationship.
// If a later session wants them load-bearing end to end, that needs a counted
// round-trip harness and its own rows.
//
// Run: SKIP_LIVE=1 node --test test/blind-v37-p2-prefill-bounds.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. `resolvePrefill` and `prefillLangFor` bundled headless against a
// STRUCTURAL vscode stub - real Position/Range with contains/compareTo so a tree
// walk that does span math runs honestly. `workspace.openTextDocument` serves a
// uri->text map through a process global. Mechanics copied from the bottom of
// test/impl-v36-p1-commenttypes.test.cjs and test/review-v34-prefill-cap.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v37-p2-vscode-stub.cjs");
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
      const files = globalThis.__V37P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v37-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v37-p2.bundle.cjs");
let resolvePrefill;
let prefillLangFor;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill, prefillLangFor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill, prefillLangFor } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that a
// reader could mistake for contract failures.
test("bundle guard: the prefill seam and the prefill entry point build headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof prefillLangFor, "function", "prefillLangFor must be exported");
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// The three values, from the goal. Named once so that a later item moving Rust
// to 12 has to edit THIS FILE deliberately and cannot drift into it.
const TYPE_CAP = 4;
const RESOLVE_CAP = 8;
const PROVENANCE_CAP = 24;

// REVERSED IN PART BY session-v42 PHASE 2, on purpose and with the session's
// name on it - the deliberate edit the comment above demands.
//
// The v37 contract shipped the seam as a no-op: five languages, one value, 4
// everywhere, precisely SO a later measurement could move one language alone.
// Session-v42 is that measurement, for Go: the authored-gesture funnel's cap
// ladder (session-v42/funnel-report.md addendum, funnel-rows-cap{4,6,8,12})
// reads in-cap 50.9% -> 78.8% and injected 34.8% -> 53.9% going 4 -> 8, with
// the knee at 8 because 8 EQUALS the resolve cap - a type cap above it promises
// slots that can never be filled. Rust STAYS 4: its own widening arm measured
// flat, and that refutation is WHY it keeps 4. No other language has a
// measurement, so no other language moves. The v42 contract rows are
// test/blind-v42-p2-go-cap.test.cjs; register entry docs/supersessions.md S15.
const TYPE_CAP_BY_LANG = { rust: 4, typescript: 4, csharp: 4, python: 4, go: 8 };

const LANGS = ["rust", "typescript", "csharp", "python", "go"];
const show = (v) => JSON.stringify(v);

// ===========================================================================
// Fixtures. One per language, each a function whose signature names six local
// types with a resolvable definition apiece. Six because the cap is four: a
// fixture with four candidates cannot tell a working cap from no cap at all.
// ===========================================================================

const WS = "file:///work/v37p2";
const SIX = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];

const FIXTURES = {
  rust: {
    ext: "rs",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/// Build the thing.",
    signature: (n) => `pub fn build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
    def: (t) => `pub struct ${t} { pub slot: u32 }\n`,
    hover: (t) => `pub struct ${t} { pub slot: u32 }`,
  },
  typescript: {
    ext: "ts",
    symbol: "build",
    doc: "Build the thing.",
    docLine: "/** Build the thing. */",
    signature: (n) => `export function build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
    def: (t) => `export class ${t} { slot: number = 0; }\n`,
    hover: (t) => `class ${t}`,
  },
  csharp: {
    // The method name is PascalCase, like every real C# method. That matters:
    // the C# candidate rule reads the leading token of `public uint Build(...)`
    // as a type, so a fixture that called it `build` would be testing a shape
    // no .NET file has.
    ext: "cs",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "/// <summary>Build the thing.</summary>",
    signature: (n) => `public uint Build(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
    def: (t) => `public class ${t} { public uint Slot; }\n`,
    hover: (t) => `class ${t}`,
  },
  python: {
    ext: "py",
    symbol: "build",
    doc: "Build the thing.",
    docLine: '"""Build the thing."""',
    signature: (n) => `def build(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
    def: (t) => `class ${t}:\n    slot: int = 0\n`,
    hover: (t) => `class ${t}`,
  },
  go: {
    ext: "go",
    symbol: "Build",
    doc: "Build the thing.",
    docLine: "// Build the thing.",
    signature: (n) => `func Build(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
    def: (t) => `type ${t} struct { Slot uint32 }\n`,
    hover: (t) => `type ${t} struct`,
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

// The injected types, read off the payload the way a reader would: a name in
// backticks on a header line immediately above a fenced block. Deliberately not
// a count the product reports about itself.
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

async function runPrefill(languageId, typeNames) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const signature = F.signature(typeNames);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  for (const t of typeNames) {
    const uri = `${WS}/${t.toLowerCase()}.${F.ext}`;
    files[uri] = F.def(t);
    defTypes[t] = {
      uri,
      hover: F.hover(t),
      members: [{ name: "slot", kind: "field", signature: "slot: u32", uri, line: 0, character: 5 }],
    };
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
  globalThis.__V37P2_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V37P2_FILES__;
  }
  return { text: out || "", logs, names: injectedTypes(out) };
}

const dump = (r) => `\n  INJECTED=${show(r.names)}\n  LOGS=${show(r.logs)}\n  PAYLOAD:\n${r.text}`;

// ===========================================================================
// A. EVERY LANGUAGE CARRIES ALL THREE, AND EVERY VALUE IS 4, 8, 24.
//
// One row per language, values written out. A row that only checked `rust`
// cannot tell a per-language seam from a module constant with a nicer name, so
// the five rows are the contract and not repetition.
// ===========================================================================

// The [go] row is REVERSED by session-v42 phase 2 (see the v42 note at
// TYPE_CAP_BY_LANG): its typeCap is the measured 8. The other four rows keep 4
// and are now the guard AGAINST drift - a language silently inheriting Go's 8
// turns its own row red here.
for (const languageId of LANGS) {
  btest(`A [${languageId}]: its own PrefillLang entry carries typeCap ${TYPE_CAP_BY_LANG[languageId]}, resolveCap 8, provenanceCap 24`, () => {
    const lang = prefillLangFor(languageId);
    assert.ok(lang, `${languageId} must have a prefill entry at all`);
    assert.equal(
      lang.typeCap,
      TYPE_CAP_BY_LANG[languageId],
      `${languageId}: typeCap bounds what is INJECTED and spends prompt bytes, roughly 765 per type. ` +
        `${TYPE_CAP} for every language except Go's measured 8 (v42 funnel ladder). Got ${show(lang.typeCap)}`,
    );
    assert.equal(
      lang.resolveCap,
      RESOLVE_CAP,
      `${languageId}: resolveCap bounds what is RESOLVED and spends one language-server round trip each. ` +
        `Unchanged at ${RESOLVE_CAP}. Got ${show(lang.resolveCap)}`,
    );
    assert.equal(
      lang.provenanceCap,
      PROVENANCE_CAP,
      `${languageId}: provenanceCap bounds the definition lookups. Unchanged at ${PROVENANCE_CAP}. ` +
        `Got ${show(lang.provenanceCap)}`,
    );
  });
}

btest("A6: the five languages resolve to five DISTINCT entries, so five bounds are five reads", () => {
  // The premise the whole seam rests on. If two languages shared an entry, item
  // 3 could not move one language's cap without moving the other's, and this
  // file's five rows above would be one row wearing five hats.
  const entries = LANGS.map((l) => prefillLangFor(l));
  entries.forEach((e, i) => assert.ok(e, `${LANGS[i]} must have a prefill entry`));
  assert.equal(
    new Set(entries).size,
    LANGS.length,
    `each language needs its own entry object; got ${new Set(entries).size} distinct for ${show(LANGS)}`,
  );
});

btest("A7: an unknown language id falls back to the RUST entry, bounds included", () => {
  // The declared fallback. It matters for the bounds specifically: an unknown id
  // that answered `undefined` for typeCap would inject nothing at all, and an id
  // that answered its own invented number would be a sixth language nobody
  // measured.
  const rust = prefillLangFor("rust");
  for (const unknown of ["klingon", "", undefined]) {
    const lang = prefillLangFor(unknown);
    assert.equal(lang, rust, `${show(unknown)} must fall back to the Rust entry itself, not a copy`);
    assert.equal(lang.typeCap, TYPE_CAP, `${show(unknown)}: typeCap. Got ${show(lang.typeCap)}`);
    assert.equal(lang.resolveCap, RESOLVE_CAP, `${show(unknown)}: resolveCap. Got ${show(lang.resolveCap)}`);
    assert.equal(lang.provenanceCap, PROVENANCE_CAP, `${show(unknown)}: provenanceCap. Got ${show(lang.provenanceCap)}`);
  }
  // The control: a KNOWN id resolves too, so the row above is not passing
  // because every lookup returns the Rust entry.
  assert.notEqual(prefillLangFor("go"), rust, "a known language id must NOT land on the Rust fallback");
});

// ===========================================================================
// B. THE THREE ARE INDEPENDENT, AND THE SEAM IS THE ONLY SOURCE.
// ===========================================================================

// REVERSED IN PART BY session-v42 phase 2 (see the v42 note at
// TYPE_CAP_BY_LANG). The row's SUBJECT - the three are separate own members,
// none derived - survives verbatim; it is exactly what let v42 move Go's
// typeCap without touching Go's round trips. What moved is the "three distinct
// values" arithmetic: Go's measured typeCap EQUALS its resolveCap (the ladder's
// knee sits AT the resolve cap), so Go carries two distinct values, not three.
// Equal by measurement is not derived-from: the moved-copy assertions below
// still prove independence for every language, Go included.
btest("B1: the three are three separate own members, none derived from another", () => {
  // Today resolveCap happens to be twice typeCap in four languages, and equals
  // it in Go. Coincidences of the shipped values, not a rule. If `resolveCap`
  // were computed from typeCap, a session moving one language's typeCap would
  // silently move the round trips as well, which is a latency change nobody
  // asked for and nobody would measure.
  for (const languageId of LANGS) {
    const lang = prefillLangFor(languageId);
    for (const key of ["typeCap", "resolveCap", "provenanceCap"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(lang, key),
        `${languageId}: ${key} must be an own member of the entry, not inherited or absent. ` +
          `Entry keys: ${show(Object.keys(lang))}`,
      );
      assert.equal(typeof lang[key], "number", `${languageId}: ${key} must be a number, got ${typeof lang[key]}`);
    }
    assert.equal(
      new Set([lang.typeCap, lang.resolveCap, lang.provenanceCap]).size,
      languageId === "go" ? 2 : 3,
      `${languageId}: the bounds are ${TYPE_CAP_BY_LANG[languageId]}, ${RESOLVE_CAP} and ${PROVENANCE_CAP}` +
        (languageId === "go" ? " - typeCap equals resolveCap by the v42 measurement, so two distinct values" : ""),
    );
    // A copy with one member moved leaves the other two where they were. Copy,
    // not the real table, so nothing here leaks into a later row.
    const moved = { ...lang, typeCap: 12 };
    assert.equal(moved.resolveCap, RESOLVE_CAP, `${languageId}: moving typeCap must not move resolveCap`);
    assert.equal(moved.provenanceCap, PROVENANCE_CAP, `${languageId}: moving typeCap must not move provenanceCap`);
    assert.equal(lang.typeCap, TYPE_CAP_BY_LANG[languageId], `${languageId}: and the real entry is untouched by the copy`);
  }
});

btest("B2: the seam is LOAD-BEARING - moving rust's typeCap moves rust's injected count and nothing else", async () => {
  // The row this file exists for. A refactor that reads `lang.typeCap` in one
  // place and the module constant where the slice actually happens ships green
  // with a decorative seam. The only way to tell from outside is to move the
  // per-language number and watch the payload.
  const rust = prefillLangFor("rust");
  const before = rust.typeCap;
  let restored = false;
  try {
    rust.typeCap = 2;
    assert.equal(
      rust.typeCap,
      2,
      `the entry must be writable for this row to say anything. If the table is frozen, the seam ` +
        `needs a different lever and the builder has to say so in writing rather than let this row skip`,
    );
    const moved = await runPrefill("rust", SIX);
    assert.equal(
      moved.names.length,
      2,
      `rust's typeCap is the number the injection is cut to. Still ${moved.names.length} injected with ` +
        `the seam at 2 means the slice reads a module constant and the seam is decorative.${dump(moved)}`,
    );
    // Per-language, not global: the other four must not have moved with it.
    const ts = await runPrefill("typescript", SIX);
    assert.equal(
      ts.names.length,
      TYPE_CAP,
      `typescript reads its OWN entry. If it moved with rust, the bounds are one shared object and ` +
        `item 3 cannot touch one language alone.${dump(ts)}`,
    );
  } finally {
    rust.typeCap = before;
    if (before === undefined) delete rust.typeCap;
    restored = true;
  }
  assert.ok(restored, "the real table must be put back before any later row reads it");
  // The control: with the entry restored, the budget is back where it started.
  const after = await runPrefill("rust", SIX);
  assert.equal(after.names.length, TYPE_CAP, `restoring the entry restores the budget.${dump(after)}`);
});

// ===========================================================================
// C. THE RELATIONSHIPS THAT MAKE THE NUMBERS MAKE SENSE.
//
// Shape rather than value. These survive item 3 moving a number; they fail when
// a number is moved WITHOUT its neighbours, which is the mistake a per-language
// table makes easy.
// ===========================================================================

btest("C1: resolveCap is at least typeCap, in every language - you cannot inject what you never resolved", () => {
  for (const languageId of LANGS) {
    const lang = prefillLangFor(languageId);
    assert.ok(
      lang.resolveCap >= lang.typeCap,
      `${languageId}: typeCap ${show(lang.typeCap)} bounds the injected set, which is drawn from the ` +
        `resolved set bounded by resolveCap ${show(lang.resolveCap)}. A typeCap above resolveCap buys ` +
        `slots that can never be filled, so raising one without the other is a silent no-op`,
    );
  }
});

btest("C2: provenanceCap is at least resolveCap, in every language - the cheapest check runs widest", () => {
  for (const languageId of LANGS) {
    const lang = prefillLangFor(languageId);
    assert.ok(
      lang.provenanceCap >= lang.resolveCap,
      `${languageId}: provenance is one definition lookup and resolution is a full round trip, so the ` +
        `cheap check bounds the wider set. provenanceCap ${show(lang.provenanceCap)} below resolveCap ` +
        `${show(lang.resolveCap)} would resolve candidates whose provenance was never established`,
    );
  }
});

// ===========================================================================
// D. THE BUDGET, OBSERVED END TO END, IN ALL FIVE LANGUAGES.
//
// The frozen oracles named in the header pin this for Rust and nowhere else.
// This row is the other four. It is GREEN today and must stay green through
// item 2, which is the whole no-op claim; it goes red the moment any language's
// injected budget moves, which is item 3's one-way door showing up here as well
// as in the two frozen blind rows.
// ===========================================================================

// REVERSED IN PART BY session-v42 phase 2 (see the v42 note at
// TYPE_CAP_BY_LANG). This was item 2's no-op row: six candidates, four
// injected, everywhere. Go injecting six IS the change's whole point - the
// funnel measured 4 as the binding leak (in-cap 50.9%, injected 34.8%) and 8
// as the knee. Six candidates cannot exercise a cap of 8, so the Go leg runs
// TEN and demands exactly 8 survive: the row keeps its teeth against Go
// serving MORE than 8, and the four-language legs keep theirs against a
// language silently inheriting Go's cap.
btest("D1: candidates beyond the budget inject exactly the language's own cap - 4 in four languages, Go's measured 8", async () => {
  const TEN = SIX.concat(["Eta", "Theta", "Iota", "Kappa"]);
  for (const languageId of LANGS) {
    // The control first. Three candidates inject three, so the cut below is the
    // BUDGET biting and not the fixture running out of types to resolve.
    const three = await runPrefill(languageId, SIX.slice(0, 3));
    assert.equal(
      three.names.length,
      3,
      `${languageId}: control - under the budget, every resolvable candidate is injected. A count ` +
        `below 3 means the fixture, not the cap, is doing the cutting and the row below proves ` +
        `nothing.${dump(three)}`,
    );
    const cap = TYPE_CAP_BY_LANG[languageId];
    const pool = languageId === "go" ? TEN : SIX;
    const over = await runPrefill(languageId, pool);
    assert.equal(
      over.names.length,
      cap,
      `${languageId}: ${pool.length} candidates resolve and exactly ${cap} are injected.${dump(over)}`,
    );
    assert.deepEqual(
      over.names,
      pool.slice(0, cap),
      `${languageId}: and it is the first ${cap} in rank order that survive, not an arbitrary ` +
        `${cap}.${dump(over)}`,
    );
  }
});
