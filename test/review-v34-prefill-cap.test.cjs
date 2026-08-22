// ADVERSARIAL REVIEW - session-v34 item 1, the half of the selection problem the
// fix does not reach: the TYPE CAP.
//
// Item 1 skips the stdlib candidate inside the RENDER loop, which is downstream of
// `kept = candidates.slice(0, PREFILL_TYPE_CAP)`. So a stdlib type still spends
// one of the four candidate slots and the project type behind the cap is still
// dropped - the shared byte budget is freed, the slot is not. `load_api_keys` had
// exactly four candidates and could not show this; a file whose signature names
// five types can.
//
// Harness mechanics copied from test/blind-v34-stdlib-provenance.test.cjs.
//
// Run: SKIP_LIVE=1 node --test test/review-v34-prefill-cap.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v34-cap-vscode-stub.cjs");
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
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor: class {}, MarkdownString: class {},
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
      const files = globalThis.__RV34CAP_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".review-v34-cap.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v34-cap.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.ok(typeof resolvePrefill === "function");
});
const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

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
const DECL = (n) => new RegExp(`\\b(?:struct|enum|union)\\s+${n}\\b`);

function makeExtractor(files, defTypes, opt = {}) {
  const known = new Set(Object.keys(defTypes));
  const noDefinitionFor = new Set(opt.noDefinitionFor || []);
  const examples = opt.examples || {};
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
    const ln = lines.findIndex((l) => DECL(t).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      if (!t || noDefinitionFor.has(t)) return undefined;
      return defLocFor(t);
    },
    hoverSurface: async (c) => { const t = typeAtCursor(c.uri, c); const h = t ? defTypes[t].hover : undefined; return h ? { signature: h } : undefined; },
    membersOfType: async (c) => { const t = typeAtCursor(c.uri, c); return (t && defTypes[t].members) || []; },
    example: async (_c, prefer) => examples[prefer],
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// ===========================================================================
// The fixture. Five candidate types in ONE signature: `Path` (whose definition
// is in the rustup sysroot) and four project structs. `Result` never reaches the
// candidate list (Amendment A), so the ordered candidates are
// Path, Alpha, Beta, Gamma, Delta - one more than the cap.
// ===========================================================================

const WS = "file:///work/proj/src";
const LIB = "file:///home/u/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library";
const MAIN_URI = `${WS}/api_keys.rs`;
const STD_PATH_URI = `${LIB}/std/src/path.rs`;

const MAIN_SRC = `use std::path::Path;

/// Load the api keys.
pub fn load_api_keys(dir: &Path, a: Alpha, b: Beta, g: Gamma, d: Delta) -> u32 {
    todo!()
}
`;

const PROJECT = ["Alpha", "Beta", "Gamma", "Delta"];
const DEF_FILES = {
  [STD_PATH_URI]: `pub struct Path { inner: OsStr }\n`,
};
const DEF_TYPES = {
  Path: {
    uri: STD_PATH_URI,
    hover: "pub struct Path { inner: OsStr }",
    members: [{ name: "from_u8_slice", kind: "method", signature: "from_u8_slice(s: &[u8]) -> &Path", uri: STD_PATH_URI, line: 0, character: 11 }],
  },
};
for (const n of PROJECT) {
  const uri = `${WS}/${n.toLowerCase()}.rs`;
  DEF_FILES[uri] = `pub struct ${n} { pub ${n.toLowerCase()}_slot: u32 }\n`;
  DEF_TYPES[n] = {
    uri,
    hover: `pub struct ${n} { pub ${n.toLowerCase()}_slot: u32 }`,
    members: [{ name: `${n.toLowerCase()}_slot`, kind: "field", signature: `${n.toLowerCase()}_slot: u32`, uri, line: 0, character: 11 }],
  };
}

function headerTypes(out) {
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

async function runPrefill(extractorOpt) {
  const src = MAIN_SRC;
  const start = src.indexOf("pub fn load_api_keys");
  const end = src.indexOf("}\n", start) + 1;
  const files = { ...DEF_FILES, [MAIN_URI]: src };
  const record = {
    span: { start, end },
    signature: "pub fn load_api_keys(dir: &Path, a: Alpha, b: Beta, g: Gamma, d: Delta) -> u32",
    docComment: "Load the api keys.",
    symbolName: "load_api_keys",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  globalThis.__RV34CAP_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(makeExtractor(files, DEF_TYPES, extractorOpt), makeDoc(src, MAIN_URI), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__RV34CAP_FILES__;
  }
  return { text: out || "", logs, names: headerTypes(out) };
}

rtest("item 1 frees the byte budget but not the CAP SLOT: the fifth project type is still dropped", async () => {
  const r = await runPrefill();
  const dump = `\n  RENDERED=${JSON.stringify(r.names)}\n  LOGS=${JSON.stringify(r.logs, null, 1)}\n  PAYLOAD:\n${r.text}`;
  // Non-vacuity: the stdlib type must indeed have rendered nothing, or this row
  // is measuring something else.
  assert.ok(!r.names.includes("Path"), `precondition: item 1 renders nothing for the sysroot type${dump}`);
  assert.deepStrictEqual(
    PROJECT.filter((n) => !r.names.includes(n)),
    [],
    `the stdlib candidate renders nothing and STILL spends one of the four candidate slots, ` +
      `so a project type the model cannot know stays behind the cap. The skip is inside the ` +
      `render loop, downstream of the slice that applied PREFILL_TYPE_CAP.${dump}`,
  );
});

// ===========================================================================
// The provenance test needs a `defUri`, and `defUri` needs the definition round
// trip to succeed. When it does not - which for std types is exactly the box
// where the `rust-src` component is not installed - the candidate is dropped by
// the resolver, `derived` is undefined, the item-1 skip cannot fire, and the
// candidate falls through to the WORKED EXAMPLE leg. Item 1's own comment says a
// stdlib root gets "no data shape, no member list, and no worked example
// either"; the third of those is unenforced.
// ===========================================================================

// REVISED during triage, and the reason is on the record here.
//
// This row originally asserted that a candidate with NO resolvable definition
// must be refused anyway. Two things are wrong with that. Item 1 forbids a name
// blocklist, and a blocklist is the only mechanism that can refuse a type whose
// provenance is unknown - so the assertion demanded the one implementation the
// contract rules out. And the fixture is not a state a real extractor reaches: it
// withholds `definition()` while still answering `example()`, and both come from
// the same rust-analyzer index, so a box that cannot resolve std definitions
// cannot produce std doc examples either.
//
// What it pins now is the contract as written: provenance is EVIDENCE, an
// unprovable candidate is not refused, and the channel says so rather than
// leaving a reader to conclude the rule ran and passed it. The safe direction is
// the one the goal names - refusing a stdlib type by mistake costs the prompt
// nothing, refusing a project type starves the model.
rtest("a candidate whose definition does not resolve is NOT refused, and the channel says its provenance is unknown", async () => {
  const r = await runPrefill({
    noDefinitionFor: ["Path"],
    examples: { Path: `let p = Path::new("/tmp");\nlet joined = p.join("api_keys.json");` },
  });
  const dump = `\n  RENDERED=${JSON.stringify(r.names)}\n  LOGS=${JSON.stringify(r.logs, null, 1)}\n  PAYLOAD:\n${r.text}`;
  assert.ok(
    r.names.includes("Path"),
    `provenance is evidence, not a guess: with no defUri there is nothing to refuse on, so the ` +
      `candidate keeps the pre-existing worked-example path.${dump}`,
  );
  assert.ok(
    r.logs.some((l) => /Path/.test(l) && /provenance is unknown/.test(l)),
    `the unprovable case must be VISIBLE, or a reader concludes the provenance rule ran and ` +
      `cleared it.${dump}`,
  );
  assert.ok(
    !r.logs.some((l) => /Path/.test(l) && /standard library/.test(l)),
    `and it must never be reported as a proven stdlib skip.${dump}`,
  );
});
