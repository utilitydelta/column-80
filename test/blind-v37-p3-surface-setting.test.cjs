// BLIND CONTRACT ORACLE - session-v37 item 2b, "the injection budget becomes a
// setting". Written from `session-v37/goal.md`, the declared facade and the
// shipped `package.json` only. `src/vscode/fnGen.ts` was never read while writing
// this file.
//
// THE CONTRACT. Three numbers bound the pre-fill injection and item 2 put all
// three on the per-language `PrefillLang` seam:
//
//   typeCap (4)        spends PROMPT BYTES, roughly 765 per injected type
//   resolveCap (8)     spends LATENCY, one language-server round trip each
//   provenanceCap (24) spends the same latency currency, on definition lookups
//
// They were tuned for a small local model. A developer pointing the extension at
// a frontier model is stuck with a number chosen for someone else's serving cap,
// so the BYTE budget becomes a setting: `column80.injectedSurface`, a string enum
// of exactly `auto | minimal | generous`, defaulting to `auto`. `auto` is today's
// behaviour per language, which is why the frozen prompt-byte oracles do not move.
//
// TWO READS, AND THE PAIR IS THE CONTRACT.
//
//   prefillLangFor(id).typeCap        that language's DEFAULT byte budget
//   injectedTypeCap(prefillLangFor(id))   the budget IN FORCE, setting applied
//
// The setting is applied on top rather than through a getter on the entry,
// because the admission loop tests the cap once per candidate and a getter would
// pay a config read every iteration. It is read once per pre-fill instead.
//
// That split is also what keeps the previous phase intact: P2 row B2 assigns to
// `prefillLangFor("rust").typeCap` and requires the injected count to follow, and
// P2 row A7 asserts an unknown language id returns the Rust entry BY IDENTITY. A
// getter would have broken the first, a wrapper object the second.
//
// Reading both is stronger than reading either. Under `auto` they agree in all
// five languages. Under `minimal` and `generous` the IN-FORCE value moves and the
// DEFAULT must not, which is row A3, the row that catches a build that
// "implements" the setting by rewriting the per-language table underneath it.
//
// THE DESIGN THIS FILE EXISTS TO REFUSE. The goal argues against one specific
// shape and this file is what stops it being built later.
//
//   1. One knob driving all three caps behind a percentage. The three do not
//      spend the same currency. Turning the knob up for a large-context model
//      would multiply the language-server round trips, which have nothing to do
//      with the model, and the developer gets a slower editor without being told.
//      Section B is that refusal: both latency caps identical under all three
//      values, with the in-force byte budget as the control that DOES move.
//   2. A per-language setting key. Nobody can be expected to know that Rust wants
//      a larger budget than TypeScript, and the item 3 measurement is the
//      product's job to hold, not the user's. Section D and section F are that
//      refusal, from behaviour and from the manifest.
//
// NO NUMBER IS FROZEN FOR `minimal` AND `generous`. The goal does not give one,
// and session-v34 measured injected bytes DOWN 11.2% with the compile rate UP, so
// the sign of this lever is not established. Freezing an unmeasured number here
// would only guarantee this file gets edited when item 3 measures it, which is
// worse than no row. Direction and invariants only.
//
// NO ROW READS A BOUND FROM A MODULE CONSTANT. The goal says so explicitly. The
// one literal in this file is 4, taken from the goal's own prose as the anchor
// the direction rows are relative to.
//
// SIBLING, NOT DUPLICATE. `test/blind-v37-p2-prefill-bounds.test.cjs` pins item
// 2: the three bounds exist per language at 4, 8 and 24, the seam is load-bearing
// end to end, and the five entries are distinct. It has no lever on the setting
// because the setting did not exist. This file is the setting half.
//
// Run: SKIP_LIVE=1 node --test test/blind-v37-p3-surface-setting.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. `prefillLangFor`, `injectedTypeCap` and `resolvePrefill` bundled
// headless against a STRUCTURAL vscode stub. The one thing this stub does that
// P2's does not is serve a SETTABLE configuration: `getConfiguration(section)
// .get(key, fallback)` reads a process global the test writes and falls back
// exactly like the real API when the key is unset. That is the lever the whole
// file turns on. Mechanics copied from the bottom of
// test/impl-v36-p1-commenttypes.test.cjs and test/blind-v37-p2-prefill-bounds.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v37-p3-vscode-stub.cjs");
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
// The settable half. A key is looked up section-qualified first, then bare, so a
// caller that asks getConfiguration("column80").get("injectedSurface", "auto")
// and one that asks getConfiguration().get("column80.injectedSurface", "auto")
// both see what the test set. Every other key falls back, as the real API does.
const readCfg = (section, key, fallback) => {
  const cfg = globalThis.__V37P3_CONFIG__ || {};
  const qualified = section ? section + "." + key : key;
  if (Object.prototype.hasOwnProperty.call(cfg, qualified)) return cfg[qualified];
  if (Object.prototype.hasOwnProperty.call(cfg, key)) return cfg[key];
  return fallback;
};
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
    getConfiguration: (section) => ({
      get: (k, f) => readCfg(section, k, f),
      has: (k) => readCfg(section, k, undefined) !== undefined,
      inspect: () => undefined,
      update: async () => {},
    }),
    openTextDocument: (arg) => {
      const files = globalThis.__V37P3_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v37-p3.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v37-p3.bundle.cjs");
let prefillLangFor;
let injectedTypeCap;
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill, prefillLangFor, injectedTypeCap } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill, prefillLangFor, injectedTypeCap } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors a reader
// could mistake for contract failures.
test("bundle guard: the seam, the in-force cap and the prefill entry point build headless against a settable vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof prefillLangFor, "function", "prefillLangFor must be exported");
  assert.equal(typeof injectedTypeCap, "function", "injectedTypeCap must be exported: it is the budget IN FORCE");
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const SETTING = "column80.injectedSurface";
const VALUES = ["auto", "minimal", "generous"];
const LANGS = ["rust", "typescript", "csharp", "python", "go"];
// The only number in this file. It comes from the goal's own prose, which is what
// `auto` must keep resolving to, and every direction row below is relative to it.
const AUTO_TYPE_CAP = 4;

// REVERSED IN PART BY session-v42 PHASE 2, on purpose and with the session's
// name on it. Six rows here quantified "in every language" over cap arithmetic
// that was uniform only because no language had been measured alone. Session-v42
// measured Go on the authored-gesture funnel (session-v42/funnel-report.md
// addendum): cap ladder knee at 8, in-cap 50.9% -> 78.8%, injected
// 34.8% -> 53.9%, so Go's `auto` budget is now 8 - and 8 EQUALS resolveCap, so
// `generous` legitimately clamps to exactly `auto` for Go. That clamp is this
// file's own doctrine (section C): a byte budget above resolveCap promises
// slots that can never be filled. Rust and the other three keep 4 - Rust's own
// widening arm measured flat, and nobody measured TS/C#/Python, so their rows
// now GUARD the 4 against silently inheriting Go's 8. The v42 contract rows
// are test/blind-v42-p2-go-cap.test.cjs; register entry
// docs/supersessions.md S15.
const AUTO_CAP_BY_LANG = { rust: 4, typescript: 4, csharp: 4, python: 4, go: 8 };
const show = (v) => JSON.stringify(v);

// The setting is set on the stub, never captured at module load. Every read goes
// through here so a row cannot leave the config dirty for the next.
function withSetting(value, fn) {
  const before = globalThis.__V37P3_CONFIG__;
  globalThis.__V37P3_CONFIG__ = value === undefined ? {} : { "column80.injectedSurface": value, injectedSurface: value };
  try {
    return fn();
  } finally {
    globalThis.__V37P3_CONFIG__ = before;
  }
}

// Both reads for one language under one setting value, taken together so a row
// can compare the DEFAULT against what is IN FORCE.
const readUnder = (value, languageId) =>
  withSetting(value, () => {
    const lang = prefillLangFor(languageId);
    assert.ok(lang, `${languageId} must have a prefill entry under ${show(value)}`);
    return {
      defaultTypeCap: lang.typeCap,
      inForce: injectedTypeCap(lang),
      resolveCap: lang.resolveCap,
      provenanceCap: lang.provenanceCap,
    };
  });

// ===========================================================================
// A. THE SETTING GOVERNS THE INJECTED BYTE BUDGET, IN THE STATED DIRECTION.
// ===========================================================================

btest("A1: the setting ABSENT and the setting `auto` are the same thing, and both are today's budget", () => {
  // The free property the goal names: a setting whose default is the shipped
  // value does not touch the frozen prompt-byte oracles. P2 pins the shipped
  // default; it has no lever on the setting, so absent-equals-auto is this
  // file's. A default that resolved to anything else would move the frozen Rust
  // oracles the moment 2b landed, and item 3's one-way door would have been
  // walked through by accident rather than measured.
  for (const languageId of LANGS) {
    const absent = readUnder(undefined, languageId);
    const auto = readUnder("auto", languageId);
    assert.deepEqual(
      absent,
      auto,
      `${languageId}: an unset setting must read exactly as ${show("auto")}, which is what the ` +
        `getConfiguration fallback is for. absent=${show(absent)} auto=${show(auto)}`,
    );
    assert.equal(
      auto.inForce,
      auto.defaultTypeCap,
      `${languageId}: under ${show("auto")} the budget in force IS the language's default, with nothing ` +
        `applied on top. inForce=${show(auto.inForce)} default=${show(auto.defaultTypeCap)}`,
    );
    // REVERSED IN PART by session-v42 phase 2 (see the v42 note at
    // AUTO_CAP_BY_LANG): "today's budget" is per language now - Go's measured
    // 8, 4 elsewhere. Absent-equals-auto and inForce-equals-default above are
    // untouched; they were never about the value.
    assert.equal(
      auto.inForce,
      AUTO_CAP_BY_LANG[languageId],
      `${languageId}: and that default is the language's own measured value. Got ${show(auto.inForce)}`,
    );
  }
});

// REVERSED IN PART by session-v42 phase 2 (see the v42 note at
// AUTO_CAP_BY_LANG). "generous moves it UP, in every language" was true only
// while every auto budget sat below resolveCap. Go's measured auto is 8, which
// IS resolveCap, so generous clamps to exactly auto there - the honest clamp
// section C pins, not a dead setting (`minimal` still moves Go, and the four
// unmeasured languages still owe the strict UP).
btest("A2: `minimal` moves the budget in force DOWN; `generous` moves it UP until the resolve clamp binds (it does, in Go)", () => {
  // Direction, not value. The goal gives no number for either and session-v34
  // measured this lever's sign as unestablished, so a row that froze one would be
  // edited by item 3 rather than trusted by it.
  for (const languageId of LANGS) {
    const auto = readUnder("auto", languageId).inForce;
    const minimal = readUnder("minimal", languageId).inForce;
    const generousRead = readUnder("generous", languageId);
    const generous = generousRead.inForce;
    assert.ok(
      minimal < auto,
      `${languageId}: ${show("minimal")} must inject a SMALLER surface than ${show("auto")}. ` +
        `minimal=${show(minimal)} auto=${show(auto)}. Equal means the value is accepted and ignored, ` +
        `which is a setting that lies to the developer`,
    );
    if (languageId === "go") {
      assert.equal(
        generous,
        generousRead.resolveCap,
        `go: ${show("generous")} clamps to resolveCap, the ceiling on slots that can be filled. ` +
          `generous=${show(generous)} resolveCap=${show(generousRead.resolveCap)}`,
      );
      assert.equal(
        generous,
        auto,
        `go: the v42 auto cap IS the resolve cap, so generous lands exactly on auto - above it would ` +
          `promise unfillable slots, below it would be a different setting. generous=${show(generous)} ` +
          `auto=${show(auto)}`,
      );
    } else {
      assert.ok(
        generous > auto,
        `${languageId}: ${show("generous")} must inject a LARGER surface than ${show("auto")}. ` +
          `generous=${show(generous)} auto=${show(auto)}`,
      );
    }
    assert.ok(
      minimal >= 1,
      `${languageId}: ${show("minimal")} is a smaller injection, not no injection. A cap of ` +
        `${show(minimal)} turns the whole pre-fill leg dark, which is a different feature and one the ` +
        `goal does not ask for`,
    );
  }
});

btest("A3: the setting is applied ON TOP - no setting value rewrites the per-language default table", () => {
  // The row that catches a build which "implements" the setting by writing the
  // new number into the seam entries. It would pass every direction row above and
  // then leak: the entry is the item 3 measurement's home, a P2 row assigns to it
  // directly, and a table that mutates on a config read has two writers and no
  // owner. `injectedTypeCap` exists precisely so the default stays still.
  const defaults = LANGS.map((l) => readUnder("auto", l).defaultTypeCap);
  for (const value of VALUES.concat([undefined])) {
    LANGS.forEach((languageId, i) => {
      const seen = readUnder(value, languageId);
      assert.equal(
        seen.defaultTypeCap,
        defaults[i],
        `${languageId}: under ${show(value)} the seam entry's OWN typeCap must still read ` +
          `${show(defaults[i])}, the language default. It reads ${show(seen.defaultTypeCap)}, so the ` +
          `setting is being applied by mutating the per-language table instead of on top of it`,
      );
    });
  }
  // The control. Without it this row passes on a setting nobody wired up: a
  // default that never moves is exactly what a dead setting looks like.
  const inForce = VALUES.map((v) => readUnder(v, "rust").inForce);
  assert.equal(
    new Set(inForce).size,
    VALUES.length,
    `CONTROL - the three values must produce three DISTINCT in-force budgets, or the rows above pass ` +
      `because nothing moves at all. Got ${show(inForce)} for ${show(VALUES)}`,
  );
});

// ===========================================================================
// A4. THE SETTING IS LOAD-BEARING END TO END, IN BYTES.
//
// The acceptance asks for the injected surface to move "in the stated direction,
// asserted in bytes". A number that moves while the payload does not ships green
// on the rows above alone. This is the row that costs it.
// ===========================================================================

const WS = "file:///work/v37p3";
const EIGHT = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];

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
    // PascalCase method name, like every real C# method: the C# candidate rule
    // reads the leading token of `public uint Build(...)` as a type, so a
    // lowercase fixture would be testing a shape no .NET file has.
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

// The injected types read off the payload the way a reader would: a name in
// backticks on a header line immediately above a fenced block. Deliberately not a
// count the product reports about itself.
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
  globalThis.__V37P3_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V37P3_FILES__;
  }
  return { text: out || "", bytes: Buffer.byteLength(out || "", "utf8"), logs, names: injectedTypes(out) };
}

// The setting has to be in force for the whole async run, so this cannot use the
// synchronous withSetting above.
async function runPrefillUnder(value, languageId, typeNames) {
  const before = globalThis.__V37P3_CONFIG__;
  globalThis.__V37P3_CONFIG__ = value === undefined ? {} : { "column80.injectedSurface": value, injectedSurface: value };
  try {
    return await runPrefill(languageId, typeNames);
  } finally {
    globalThis.__V37P3_CONFIG__ = before;
  }
}

const dump = (label, r) => `\n  [${label}] BYTES=${r.bytes} INJECTED=${show(r.names)}\n  LOGS=${show(r.logs)}\n  PAYLOAD:\n${r.text}`;

// REVERSED IN PART by session-v42 phase 2 (see the v42 note at
// AUTO_CAP_BY_LANG). Go's leg changed shape twice over: eight candidates
// cannot exercise an auto budget of 8, so Go runs TWELVE and demands exactly 8
// - the leg that goes red on Go serving MORE than its measured cap - and
// `generous` ships the SAME bytes as `auto` there, because the resolve clamp
// binds. `minimal` still moves Go's bytes, so the setting is provably alive in
// every language.
btest("A4: candidates beyond every budget, and the injected BYTES move with the setting wherever the clamp leaves room", async () => {
  const TWELVE = EIGHT.concat(["Iota", "Kappa", "Lambda", "Mu"]);
  for (const languageId of LANGS) {
    const autoCap = AUTO_CAP_BY_LANG[languageId];
    const pool = languageId === "go" ? TWELVE : EIGHT;
    const auto = await runPrefillUnder("auto", languageId, pool);
    // The anchor. More candidates than budget and exactly the budget injected is
    // the cap biting, and it is what `auto` must keep doing.
    assert.equal(
      auto.names.length,
      autoCap,
      `${languageId}: under ${show("auto")} ${pool.length} resolvable candidates inject exactly ` +
        `${autoCap}. A different count here means the fixture, not the setting, is doing the cutting ` +
        `and the rows below prove nothing.${dump("auto", auto)}`,
    );
    const minimal = await runPrefillUnder("minimal", languageId, pool);
    const generous = await runPrefillUnder("generous", languageId, pool);
    assert.ok(
      minimal.bytes < auto.bytes,
      `${languageId}: ${show("minimal")} must ship FEWER prompt bytes than ${show("auto")}. ` +
        `minimal=${minimal.bytes} auto=${auto.bytes}. A cap that moves while the payload does not is a ` +
        `decorative setting.${dump("minimal", minimal)}${dump("auto", auto)}`,
    );
    if (languageId === "go") {
      assert.equal(
        generous.bytes,
        auto.bytes,
        `go: ${show("generous")} clamps to the resolve cap, which the v42 auto cap already equals, so ` +
          `the payload is byte-identical to ${show("auto")}. generous=${generous.bytes} ` +
          `auto=${auto.bytes}.${dump("generous", generous)}${dump("auto", auto)}`,
      );
      assert.deepEqual(
        generous.names,
        auto.names,
        `go: same budget, same types.${dump("generous", generous)}${dump("auto", auto)}`,
      );
      assert.ok(
        minimal.names.length < auto.names.length,
        `go: the byte movement must come from the injected TYPE COUNT. ` +
          `minimal=${show(minimal.names)} auto=${show(auto.names)}`,
      );
    } else {
      assert.ok(
        generous.bytes > auto.bytes,
        `${languageId}: ${show("generous")} must ship MORE prompt bytes than ${show("auto")}. ` +
          `generous=${generous.bytes} auto=${auto.bytes}.${dump("generous", generous)}${dump("auto", auto)}`,
      );
      assert.ok(
        minimal.names.length < auto.names.length && auto.names.length < generous.names.length,
        `${languageId}: the byte movement must come from the injected TYPE COUNT, which is what the byte ` +
          `budget bounds, and not from some other line of the payload getting longer. ` +
          `minimal=${show(minimal.names)} auto=${show(auto.names)} generous=${show(generous.names)}`,
      );
    }
  }
});

// ===========================================================================
// B. THE TWO LATENCY CAPS DO NOT MOVE WITH THE KNOB.
//
// The refusal the goal argues hardest for. The byte budget spends prompt bytes
// and the model's context window governs it. `resolveCap` and `provenanceCap`
// spend language-server round trips, and the pre-fill leg already measures around
// 285ms against the member-site leg's 3ms. A developer who turns the knob up for
// a large-context model and silently gets more round trips has been handed a
// leaky abstraction with a longer fuse than the constants it replaced.
// ===========================================================================

btest("B1: resolveCap and provenanceCap are IDENTICAL under all three values, in every language", () => {
  for (const languageId of LANGS) {
    const seen = VALUES.map((v) => ({ value: v, caps: readUnder(v, languageId) }));
    const base = seen[0].caps;
    for (const { value, caps } of seen.slice(1)) {
      assert.equal(
        caps.resolveCap,
        base.resolveCap,
        `${languageId}: resolveCap spends one language-server round trip per candidate and has nothing ` +
          `to do with the model's context window. ${show(value)} moved it to ${show(caps.resolveCap)} ` +
          `from ${show(base.resolveCap)} under ${show("auto")}. That is the percentage-split design the ` +
          `goal refuses: the developer reads the setting as being about the model and gets a slower editor`,
      );
      assert.equal(
        caps.provenanceCap,
        base.provenanceCap,
        `${languageId}: provenanceCap spends definition lookups, the same latency currency. ` +
          `${show(value)} moved it to ${show(caps.provenanceCap)} from ${show(base.provenanceCap)}`,
      );
    }
    // The control. Without it this row passes on a setting nobody wired up at
    // all: three values that change nothing have identical latency caps too.
    // REVERSED IN PART by session-v42 phase 2 (see the v42 note at
    // AUTO_CAP_BY_LANG): in Go, generous collides with auto at the resolve
    // clamp, so three values yield TWO distinct budgets there, and the live-
    // setting proof rides on `minimal` alone. Both latency-cap assertions
    // above are exactly what they were.
    const inForce = new Set(seen.map((s) => s.caps.inForce));
    assert.equal(
      inForce.size,
      languageId === "go" ? VALUES.length - 1 : VALUES.length,
      `${languageId}: CONTROL - the values must produce distinct byte budgets (generous folds into auto ` +
        `only where the resolve clamp binds, which is Go), or the rows above are passing because the ` +
        `setting does nothing. Got ${show([...inForce])} for ${show(VALUES)}`,
    );
    if (languageId === "go") {
      assert.notEqual(
        readUnder("minimal", "go").inForce,
        readUnder("auto", "go").inForce,
        `go: CONTROL - minimal must still move the budget, or the clamp equality above is a dead setting`,
      );
    }
  }
});

// ===========================================================================
// C. THE RELATIONSHIP THAT MUST HOLD UNDER EVERY VALUE.
//
// You cannot inject what you never resolved, and the cheapest check runs widest.
// This is where the two refusals meet: because the latency caps are frozen,
// `generous` has a CEILING it did not have before, and a build that raises the
// byte budget past resolveCap buys slots that can never be filled. That is a
// silent no-op the developer pays for in nothing and gets nothing from.
// ===========================================================================

btest("C1: provenanceCap >= resolveCap >= the budget in force, under all three values and in every language", () => {
  for (const value of VALUES) {
    for (const languageId of LANGS) {
      const c = readUnder(value, languageId);
      assert.ok(
        c.resolveCap >= c.inForce,
        `${languageId} under ${show(value)}: the injected set is drawn from the resolved set. A byte ` +
          `budget of ${show(c.inForce)} above resolveCap ${show(c.resolveCap)} buys slots nothing can ` +
          `fill, so ${show(value)} would read as a bigger injection and deliver the same one. If the ` +
          `knob genuinely needs to go higher, resolveCap is a latency decision that has to be measured ` +
          `and argued, not dragged along by a byte setting`,
      );
      assert.ok(
        c.provenanceCap >= c.resolveCap,
        `${languageId} under ${show(value)}: provenance is one definition lookup and resolution is a ` +
          `full round trip, so the cheap check bounds the wider set. provenanceCap ` +
          `${show(c.provenanceCap)} below resolveCap ${show(c.resolveCap)} would resolve candidates ` +
          `whose provenance was never established`,
      );
    }
  }
});

// ===========================================================================
// D. THE PER-LANGUAGE SPLIT STAYS IN CODE.
//
// Nobody can be expected to know that Rust wants a larger budget than
// TypeScript. The setting is coarse and language-blind; the split underneath it
// is the product's to hold, and item 3 is the measurement that sets it.
// ===========================================================================

btest("D1: the setting COMPOSES with each language's own bound, it does not flatten the five to one number", () => {
  // The sharp row. Today all five languages sit at 4, so reading values alone
  // cannot tell "generous means N, everywhere" from "generous widens whatever
  // this language holds". The only way to tell from outside is to move one
  // language's default and watch whether the setting still respects it. A setting
  // that flattened the five would kill item 3 before it is measured, silently,
  // and no other row in either file would notice.
  const rust = prefillLangFor("rust");
  assert.ok(rust, "rust must have a prefill entry");
  const before = rust.typeCap;
  try {
    rust.typeCap = 2;
    assert.equal(
      readUnder("auto", "rust").inForce,
      2,
      `the per-language entry is the single source the setting is applied on top of. If writing to it no ` +
        `longer reaches the in-force budget, the setting has been built on a second copy of the bounds ` +
        `and P2 row B2 is living on borrowed time. This row then has no honest lever and the builder ` +
        `owes a written note, not a skipped row`,
    );
    const rustGenerous = readUnder("generous", "rust").inForce;
    const tsGenerous = readUnder("generous", "typescript").inForce;
    assert.ok(
      rustGenerous < tsGenerous,
      `under ${show("generous")}, rust starts from 2 and typescript from ${AUTO_TYPE_CAP}, so rust must ` +
        `still land below typescript. rust=${show(rustGenerous)} typescript=${show(tsGenerous)}. Equal ` +
        `means the setting resolves to one absolute number for every language, and the per-language ` +
        `split item 3 exists to measure has been overwritten by a user-facing knob`,
    );
    const rustMinimal = readUnder("minimal", "rust").inForce;
    const tsMinimal = readUnder("minimal", "typescript").inForce;
    assert.ok(
      rustMinimal <= tsMinimal,
      `and the same downward: rust=${show(rustMinimal)} typescript=${show(tsMinimal)} under ${show("minimal")}`,
    );
  } finally {
    rust.typeCap = before;
  }
  // The control, with the table restored: the two languages agree again, so the
  // inequality above came from the move and not from a standing difference.
  assert.equal(
    readUnder("generous", "rust").inForce,
    readUnder("generous", "typescript").inForce,
    `CONTROL - restored, rust and typescript hold the same budget, so the row above measured the move`,
  );
});

btest("D2: under EVERY setting value the five languages keep five separate entries", () => {
  // The structural precondition for the row above. One shared entry behind the
  // setting means item 3 cannot move Rust without moving the other four, and P2's
  // five-row table becomes one row wearing five hats.
  for (const value of VALUES) {
    withSetting(value, () => {
      const entries = LANGS.map((l) => prefillLangFor(l));
      entries.forEach((e, i) => assert.ok(e, `${LANGS[i]} must have a prefill entry under ${show(value)}`));
      assert.equal(
        new Set(entries).size,
        LANGS.length,
        `${show(value)}: each language needs its own entry object; got ${new Set(entries).size} distinct ` +
          `for ${show(LANGS)}`,
      );
    });
  }
});

// ===========================================================================
// E. THE SETTING IS READ AT CALL TIME.
// ===========================================================================

btest("E1: changing the setting changes the next read, with no reload", () => {
  // A value captured once at module load means a developer who turns the knob has
  // to restart the editor to see it, and nothing in the UI says so. VS Code's own
  // convention is that a settings change takes effect on the next use.
  //
  // REVERSED IN PART by session-v42 phase 2 (see the v42 note at
  // AUTO_CAP_BY_LANG): `generous` equals `auto` BY VALUE in Go (the resolve
  // clamp), so it cannot witness a read; Go's moving lever is `minimal`. The
  // subject - call-time reads, no reload - is unchanged, and each language
  // still crosses two value changes and a return trip.
  for (const languageId of LANGS) {
    const [moveA, moveB] = languageId === "go" ? ["minimal", "generous"] : ["generous", "minimal"];
    const first = readUnder("auto", languageId).inForce;
    const second = readUnder(moveA, languageId).inForce;
    assert.notEqual(
      second,
      first,
      `${languageId}: the second read happened after the setting changed and must reflect it. ` +
        `Got ${show(first)} then ${show(second)}. Identical means the value was captured at module load ` +
        `and the developer has to restart the editor to be heard`,
    );
    const third = readUnder(moveB, languageId).inForce;
    assert.notEqual(
      third,
      second,
      `${languageId}: and again on the third change. Got ${show(second)} then ${show(third)}`,
    );
    // The return trip. A read that only ever moved one way would pass the two
    // assertions above while never actually tracking the setting.
    assert.equal(
      readUnder("auto", languageId).inForce,
      first,
      `${languageId}: setting it back to ${show("auto")} must give the original budget back, ` +
        `${show(first)}, not a number that drifted with the number of reads`,
    );
  }
});

btest("E2: an unrecognised value reads as `auto`, never as a fourth behaviour", () => {
  // settings.json is a text file and the schema does not stop a hand-edit. The
  // in-repo precedent is `column80.hardwareTier`, where an unknown tier id falls
  // back to `auto` rather than disabling the feature or inventing a tier
  // (test/impl5-vscode.test.cjs pins `48gb-imagined` -> `auto`).
  for (const languageId of LANGS) {
    const auto = readUnder("auto", languageId);
    for (const junk of ["huge", "", "AUTO ", "4", "true"]) {
      assert.deepEqual(
        readUnder(junk, languageId),
        auto,
        `${languageId}: ${show(junk)} is not one of ${show(VALUES)} and must land on ${show("auto")}, ` +
          `the measured default. Got ${show(readUnder(junk, languageId))} against ${show(auto)}`,
      );
    }
    // The control: a value that IS recognised does not land on auto, so the row
    // above is not passing because every value is ignored. REVERSED IN PART by
    // session-v42 phase 2 (see the v42 note at AUTO_CAP_BY_LANG): Go's
    // `generous` reads identically to `auto` by the resolve clamp, so Go's
    // recognised-value witness is `minimal`.
    assert.notDeepEqual(
      readUnder(languageId === "go" ? "minimal" : "generous", languageId),
      auto,
      `${languageId}: CONTROL - a legal value must NOT read as auto`,
    );
  }
});

// ===========================================================================
// F. THE MANIFEST. A user reads this, not the source.
// ===========================================================================

const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const PROPS = (PKG.contributes && PKG.contributes.configuration && PKG.contributes.configuration.properties) || {};

test("F1: `column80.injectedSurface` is declared as a string enum of exactly auto, minimal and generous, defaulting to auto", () => {
  const p = PROPS[SETTING];
  assert.ok(p, `${SETTING} must be declared under contributes.configuration.properties. Present keys: ${show(Object.keys(PROPS))}`);
  assert.equal(p.type, "string", `${SETTING} is a coarse named choice, not a number the user tunes. Got ${show(p.type)}`);
  assert.deepEqual(
    p.enum,
    VALUES,
    `${SETTING} offers exactly ${show(VALUES)}, in that order, so the settings UI is a three-way pick ` +
      `and not a free-text field. Got ${show(p.enum)}`,
  );
  assert.equal(
    p.default,
    "auto",
    `${SETTING} defaults to ${show("auto")}, which is today's shipped behaviour. Any other default moves ` +
      `the frozen prompt-byte oracles and walks through item 3's one-way door by accident. Got ${show(p.default)}`,
  );
});

test("F2: it carries a description and one enumDescription per value, the convention hardwareTier already follows", () => {
  const p = PROPS[SETTING] || {};
  assert.equal(typeof p.description, "string", `${SETTING} needs a description; the settings UI shows nothing else`);
  assert.ok(p.description.trim().length > 0, `${SETTING}: the description must not be empty`);
  assert.ok(
    Array.isArray(p.enumDescriptions),
    `${SETTING} needs enumDescriptions, or the picker shows three bare words and the developer has to ` +
      `guess which way ${show("generous")} moves. Got ${show(p.enumDescriptions)}`,
  );
  assert.equal(
    p.enumDescriptions.length,
    VALUES.length,
    `${SETTING}: one enumDescription per value, ${VALUES.length} of them. Got ${show(p.enumDescriptions)}`,
  );
  p.enumDescriptions.forEach((d, i) =>
    assert.ok(typeof d === "string" && d.trim().length > 0, `${SETTING}: enumDescriptions[${i}] for ${show(VALUES[i])} is empty`),
  );
  // The control: the convention being claimed is a real one in this manifest.
  const tier = PROPS["column80.hardwareTier"];
  assert.ok(tier, "CONTROL - column80.hardwareTier must exist for the convention claim to mean anything");
  assert.equal(
    tier.enumDescriptions.length,
    tier.enum.length,
    "CONTROL - hardwareTier is the precedent: one enumDescription per enum value",
  );
});

test("F3: nothing exposes a latency cap, and nothing exposes the per-language split", () => {
  const keys = Object.keys(PROPS);
  // The control first. A scan over an empty or misread properties object finds
  // nothing and reports a clean bill of health.
  assert.ok(keys.length > 5, `CONTROL - the manifest must have real settings to scan; found ${keys.length}`);
  assert.ok(keys.includes(SETTING), `CONTROL - the one setting that SHOULD exist is ${SETTING}; found ${show(keys)}`);

  const latency = keys.filter((k) => /resolve.?cap|provenance.?cap|type.?cap|round.?trip/i.test(k));
  assert.deepEqual(
    latency,
    [],
    `"eight resolves" is not a quantity anyone can reason about from a settings page, and the two latency ` +
      `caps stay in code. These keys expose one: ${show(latency)}`,
  );

  const injected = keys.filter((k) => /injected/i.test(k));
  assert.deepEqual(
    injected,
    [SETTING],
    `exactly ONE user-facing key governs the injected surface. Extra keys here are the per-language split ` +
      `or a second cap leaking onto the settings page: ${show(injected)}`,
  );

  const perLang = keys.filter((k) => /(rust|typescript|csharp|python|golang|\bgo\b)/i.test(k) && /surface|cap|budget|inject/i.test(k));
  assert.deepEqual(
    perLang,
    [],
    `nobody can be expected to know that Rust wants a larger budget than TypeScript; the split is the ` +
      `product's job to hold. These keys hand it to the user: ${show(perLang)}`,
  );

  const p = PROPS[SETTING] || {};
  assert.equal(
    p.properties,
    undefined,
    `${SETTING} must not be an object with per-language members either. That is the same split wearing a ` +
      `different shape. Got ${show(p.properties)}`,
  );
});
