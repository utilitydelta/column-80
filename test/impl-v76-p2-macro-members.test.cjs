// session-v76 C2-C4: a macro-generated Rust type gets its members from
// completion at an existing `Type::` path, says so in words when there is no
// path, and a private tuple field renders as private.
//
// The transport is the PRODUCT's `RaCommandExtractor` over a fake command
// runner that answers from the fixture crate's real text
// (`test/fixtures/extraction-macro-ids/`). Completion answers replay the raw
// items the VS Code host's rust-analyzer returned at `TenantId::` and
// `StreamId::` in that crate (captured 2026-09-29, rust-analyzer 0.3.3049):
// the label OBJECT carries trait provenance in its own `detail`.
//
// Run: node --test test/impl-v76-p2-macro-members.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const TAG = ".impl-v76-p2-mm";
const STUB = path.join(__dirname, `${TAG}-vscode.cjs`);
const ENTRY = path.join(__dirname, `${TAG}.entry.ts`);
const OUT = path.join(__dirname, `${TAG}.bundle.cjs`);
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s).replace(/^file:\\/\\//, ""), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : a && a.toString ? a.toString() : String(a));
globalThis.__V76_EDITS__ = 0;
module.exports = {
  Position, Range, Selection: Range,
  WorkspaceEdit: class {}, EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { Method: 5, Field: 7, Function: 11, Struct: 22, Object: 18 },
  ProgressLocation: {}, EndOfLine: { LF: 1 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      if (arg && typeof arg === "object" && "content" in arg) globalThis.__V76_EDITS__++;
      const files = globalThis.__V76_FILES__ || {};
      const text = files[keyOf(arg)];
      return text === undefined ? Promise.reject(new Error("no such file")) : Promise.resolve({ uri: mkUri(keyOf(arg)), getText: () => text });
    },
    applyEdit: async () => { globalThis.__V76_EDITS__++; return true; },
  },
};
`,
);
fs.writeFileSync(
  ENTRY,
  `export { RaCommandExtractor } from "../src/vscode/raExtractor";
export { resolveCrossFileShape, markPrivateTupleFields, renderDerivedDef } from "../src/core/crossFileShape";
export { isInsideMacroInvocation } from "../src/core/macroMembers";
export { resolvePrefill } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUT, format: "cjs", platform: "node", alias: { vscode: STUB } });
const M = require(OUT);
test.after(() => [STUB, ENTRY, OUT].forEach((f) => fs.rmSync(f, { force: true })));

// ---------------------------------------------------------------------------
// The fixture crate as the fake server sees it.
// ---------------------------------------------------------------------------
const FIX = path.join(__dirname, "fixtures", "extraction-macro-ids", "src");
const WS = "file:///ws/src";
const FILES = {};
for (const f of ["ids.rs", "key.rs", "plain.rs", "lib.rs"]) FILES[`${WS}/${f}`] = fs.readFileSync(path.join(FIX, f), "utf8");
const IDS = `${WS}/ids.rs`;
const KEY = `${WS}/key.rs`;
const PLAIN = `${WS}/plain.rs`;
const GEN = `${WS}/gen.rs`;

const codeLines = (uri) => FILES[uri].split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l));
function wordAt(uri, c) {
  const line = (FILES[uri] || "").split("\n")[c.line] ?? "";
  let s = c.character;
  let e = s;
  while (s > 0 && /\w/.test(line[s - 1])) s--;
  while (e < line.length && /\w/.test(line[e])) e++;
  return line.slice(s, e);
}
function find(uri, re) {
  const lines = codeLines(uri);
  const line = lines.findIndex((l) => re.test(l));
  assert.ok(line >= 0, `fixture bug: ${re} not in ${uri}`);
  return { line, character: lines[line].search(re) };
}
const loc = (uri, line, character, len) => ({
  uri: { toString: () => uri },
  range: { start: { line, character }, end: { line, character: character + len } },
});

// Where each type is defined, and what the server says about it.
const DEFS = {
  TenantId: { uri: IDS, re: /(?<=newtype_id!\()TenantId/, hover: "pub struct TenantId(u128)" },
  StreamId: { uri: IDS, re: /(?<=newtype_id!\()StreamId/, hover: "pub struct StreamId(u128)" },
  GhostId: { uri: IDS, re: /(?<=newtype_id!\()GhostId/, hover: "pub struct GhostId(u128)" },
  StreamKey: {
    uri: KEY,
    re: /(?<=struct )StreamKey/,
    hover: "pub struct StreamKey {\n    pub tenant: TenantId,\n    pub stream: StreamId,\n    pub ghost: GhostId,\n}",
  },
  Gauge: { uri: PLAIN, re: /(?<=struct )Gauge/, hover: "pub struct Gauge {\n    level: u32,\n}" },
  SealedId: { uri: PLAIN, re: /(?<=struct )SealedId/, hover: "pub struct SealedId(u128)" },
  OpenId: { uri: PLAIN, re: /(?<=struct )OpenId/, hover: "pub struct OpenId(pub u128)" },
};
const defOf = (t) => ({ uri: DEFS[t].uri, ...find(DEFS[t].uri, DEFS[t].re) });

// documentSymbol as the server answers it: the outline sees hand-written items
// only, so ids.rs holds the macro and nothing else. vscode SymbolKind numbers.
const sym = (name, kind, line, detail = "", children = []) => ({
  name, kind, detail, children,
  range: { start: { line, character: 0 }, end: { line: line + 20, character: 0 } },
  selectionRange: { start: { line, character: 0 }, end: { line, character: name.length } },
});
const SYMBOLS = {
  [IDS]: [sym("newtype_id", 11, find(IDS, /macro_rules!/).line)],
  [KEY]: [
    sym("StreamKey", 22, defOf("StreamKey").line, "", [
      sym("tenant", 7, find(KEY, /pub tenant/).line, "TenantId"),
      sym("stream", 7, find(KEY, /pub stream/).line, "StreamId"),
      sym("ghost", 7, find(KEY, /pub ghost/).line, "GhostId"),
    ]),
    sym("impl StreamKey", 18, find(KEY, /^impl StreamKey/).line, "", [
      sym("new", 11, find(KEY, /pub fn new/).line, "fn(tenant: TenantId, stream: StreamId, ghost: GhostId) -> Self"),
      sym("is_blank", 5, find(KEY, /pub fn is_blank/).line, "fn(&self) -> bool"),
    ]),
  ],
  [PLAIN]: [
    sym("Gauge", 22, defOf("Gauge").line, "", [sym("level", 7, find(PLAIN, /^\s+level: u32/).line, "u32")]),
    sym("impl Gauge", 18, find(PLAIN, /^impl Gauge/).line, "", [
      sym("empty", 11, find(PLAIN, /fn empty/).line, "fn() -> Self"),
      sym("level", 5, find(PLAIN, /pub fn level\(/).line, "fn(&self) -> u32"),
    ]),
    sym("OpenId", 22, defOf("OpenId").line),
    sym("SealedId", 22, defOf("SealedId").line),
    sym("impl SealedId", 18, find(PLAIN, /^impl SealedId/).line, "", [sym("new", 11, find(PLAIN, /fn new/).line, "fn(raw: u128) -> Self")]),
  ],
};

// The host's raw completion items at `TenantId::` and `StreamId::`, trimmed to
// the inherent members plus a spread of trait members in both label forms.
const hostItems = (t, parens) => {
  const p = parens ? "(…)" : "";
  return [
    { label: { label: `new${p}`, description: `const fn(u128) -> ${t}` }, kind: 2, detail: `const fn(u128) -> ${t}`, sortText: "7fffffc5" },
    { label: { label: `clone${p}`, detail: "(as Clone)", description: "fn(&self) -> Self" }, kind: 1, detail: "fn(&self) -> Self", sortText: "7fffffec" },
    { label: { label: `from${p}`, detail: "(as From)", description: "fn(T) -> Self" }, kind: 2, detail: "fn(T) -> Self", sortText: "7fffffec" },
    { label: { label: "SENTINEL", detail: ` = ${t}(0)`, description: "pub const SENTINEL: Self" }, kind: 20, detail: "pub const SENTINEL: Self", sortText: "7ffffff6" },
    { label: { label: `get${p}`, description: "const fn(self) -> u128" }, kind: 1, detail: "const fn(self) -> u128", sortText: "7ffffff6" },
    { label: { label: `is_sentinel${p}`, description: "const fn(self) -> bool" }, kind: 1, detail: "const fn(self) -> bool", sortText: "7ffffff6" },
    { label: { label: `eq${p}`, detail: "(as PartialEq)", description: "fn(&self, &Rhs) -> bool" }, kind: 1, detail: "fn(&self, &Rhs) -> bool", sortText: "80000000" },
    { label: { label: `fmt${p}`, detail: "(use std::fmt::Debug)", description: "fn(&self, &mut Formatter<'_>) -> Result<(), Error>" }, kind: 1, detail: "fn(&self, &mut Formatter<'_>) -> Result<(), Error>", sortText: "80000007" },
    { label: { label: `hash${p}`, detail: "(use std::hash::Hash)", description: "fn(&self, &mut H)" }, kind: 1, detail: "fn(&self, &mut H)", sortText: "80000007" },
  ];
};

// Every occurrence of the type's name on a code line, declaration first: what
// the reference provider returns, in file order.
function referencesTo(t) {
  const out = [];
  const d = defOf(t);
  out.push(loc(d.uri, d.line, d.character, t.length));
  for (const uri of [KEY, PLAIN, GEN]) {
    if (FILES[uri] === undefined) continue;
    codeLines(uri).forEach((l, line) => {
      for (const m of l.matchAll(new RegExp(`\\b${t}\\b`, "g"))) out.push(loc(uri, line, m.index, t.length));
    });
  }
  return out;
}

function makeServer() {
  const calls = [];
  const run = async (command, cursor, opts) => {
    calls.push({ command, cursor, opts });
    const w = wordAt(cursor.uri, cursor);
    switch (command) {
      case "vscode.executeDefinitionProvider":
        if (!DEFS[w]) return [];
        return [loc(DEFS[w].uri, defOf(w).line, defOf(w).character, w.length)];
      case "vscode.executeHoverProvider":
        return DEFS[w] ? [{ contents: [{ value: "```rust\n" + DEFS[w].hover + "\n```" }] }] : [];
      case "vscode.executeDocumentSymbolProvider":
        return SYMBOLS[cursor.uri] ?? [];
      case "vscode.executeReferenceProvider":
        return DEFS[w] ? referencesTo(w) : [];
      case "vscode.executeCompletionItemProvider": {
        const line = (FILES[cursor.uri] || "").split("\n")[cursor.line] ?? "";
        const before = /(\w+)::$/.exec(line.slice(0, cursor.character));
        if (!before) return { items: [] };
        return { items: hostItems(before[1], before[1] === "StreamId") };
      }
      default:
        return undefined;
    }
  };
  return { ex: new M.RaCommandExtractor(run, (u) => FILES[u]), calls };
}
const count = (calls, cmd) => calls.filter((c) => c.command === cmd).length;
const openFile = async (u) => FILES[u];
const BOUND = { D_MAX: 2, N_MAX: 8 };

async function walk(rootType, rootUri = KEY) {
  const { ex, calls } = makeServer();
  const at = rootUri === KEY && rootType !== "StreamKey" ? find(KEY, new RegExp(`\\b${rootType}\\b`)) : defOf(rootType);
  const shape = await M.resolveCrossFileShape(ex, { uri: at.uri ?? rootUri, line: at.line, character: at.character }, BOUND, openFile);
  return { shape, calls };
}

// ---------------------------------------------------------------------------
// C2: the walk
// ---------------------------------------------------------------------------
test("StreamKey's walk carries the macro members of TenantId and StreamId, inherent only", async () => {
  const { shape, calls } = await walk("StreamKey");
  for (const t of ["TenantId", "StreamId"]) {
    assert.deepStrictEqual(
      shape.types.get(t)?.methods,
      [`new(u128) -> ${t}`, "get(self) -> u128", "is_sentinel(self) -> bool"],
      `${t}: ${JSON.stringify(shape.types.get(t))}`,
    );
  }
  // One completion ask per type that has a path, none for GhostId, one
  // reference query per macro-generated type, and nothing for StreamKey.
  assert.strictEqual(count(calls, "vscode.executeCompletionItemProvider"), 2);
  assert.deepStrictEqual(
    calls.filter((c) => c.command === "vscode.executeReferenceProvider").map((c) => wordAt(c.cursor.uri, c.cursor)).sort(),
    ["GhostId", "StreamId", "TenantId"],
  );
  // The completion asks land after an EXISTING `::`, in key.rs.
  for (const c of calls.filter((c) => c.command === "vscode.executeCompletionItemProvider")) {
    const line = FILES[c.cursor.uri].split("\n")[c.cursor.line];
    assert.match(line.slice(0, c.cursor.character), /(TenantId|StreamId)::$/);
  }
});

test("GhostId has no path: no completion ask, and the shape names it with no path", async () => {
  const { shape } = await walk("StreamKey");
  const notes = shape.macroGenerated ?? [];
  const ghost = notes.find((n) => n.type === "GhostId");
  assert.ok(ghost, JSON.stringify(notes));
  assert.strictEqual(ghost.pathAt, undefined);
  assert.strictEqual(ghost.memberCount, 0);
  assert.ok(ghost.searched > 0, "the references were read");
  assert.deepStrictEqual(shape.types.get("GhostId")?.methods, []);
});

test("costs nothing where the outline answered or the declaration is hand-written", async () => {
  // Gauge and SealedId have outline members; OpenId has none but is declared by
  // hand, which is the empty-and-honest case the fallback must not touch.
  for (const t of ["Gauge", "SealedId", "OpenId"]) {
    const { shape, calls } = await walk(t, PLAIN);
    assert.ok(shape.types.has(t), `${t} resolved`);
    assert.strictEqual(count(calls, "vscode.executeReferenceProvider"), 0, `${t}: references`);
    assert.strictEqual(count(calls, "vscode.executeCompletionItemProvider"), 0, `${t}: completion`);
    assert.strictEqual(shape.macroGenerated, undefined, t);
  }
});

test("one completion ask per path, asked once: no empty-result retry", async () => {
  const { ex } = makeServer();
  const seen = [];
  const inner = ex.completeMembers.bind(ex);
  ex.completeMembers = (cursor, opts) => {
    seen.push(opts);
    return inner(cursor, opts);
  };
  const at = defOf("StreamKey");
  await M.resolveCrossFileShape(ex, at, BOUND, openFile);
  assert.deepStrictEqual(seen, [{ once: true }, { once: true }]);
});

// A trait, an alias and a generic parameter whose definitions sit inside a
// macro invocation, each with an empty outline and an existing `Name::` path.
// Only a data type may take the fallback. In-memory, not a fixture file.
test("never fires for a trait, an alias or a generic parameter, even inside a macro", async () => {
  const MAC = `${WS}/mac.rs`;
  FILES[MAC] = [
    "define!(Handler);",
    "define!(Alias);",
    "define!(fn f<Param>() {});",
    "pub fn use_them() { Handler::x(); Alias::y(); Param::z(); }",
  ].join("\n");
  const hovers = { Handler: "pub trait Handler", Alias: "type Alias = u8", Param: "Param" };
  try {
    for (const [t, hover] of Object.entries(hovers)) {
      DEFS[t] = { uri: MAC, re: new RegExp(`(?<=define!\\((?:fn f<)?)${t}`), hover };
      const { ex, calls } = makeServer();
      const shape = await M.resolveCrossFileShape(ex, defOf(t), BOUND, openFile);
      assert.ok(shape.types.has(t), `${t} resolved`);
      assert.strictEqual(count(calls, "vscode.executeReferenceProvider"), 0, `${t}: references`);
      assert.strictEqual(count(calls, "vscode.executeCompletionItemProvider"), 0, `${t}: completion`);
      delete DEFS[t];
    }
  } finally {
    delete FILES[MAC];
  }
});

// ---------------------------------------------------------------------------
// The gate's lexer, over shapes the fixture does not carry.
// ---------------------------------------------------------------------------
test("the macro-invocation gate", () => {
  const at = (text, needle) => {
    const i = text.indexOf(needle);
    const before = text.slice(0, i).split("\n");
    return { uri: "x", line: before.length - 1, character: before[before.length - 1].length };
  };
  const rows = [
    ["newtype_id!(TenantId);", "TenantId", true],
    ["bitflags! {\n    pub struct Flags: u32 {}\n}", "Flags", true],
    ["macro_rules! m { () => { pub struct Fixed; } }", "Fixed", true],
    ["pub struct Plain(u128);", "Plain", false],
    ["fn f<T>(x: T) { if !(true) { let _ = x; } }", "T>", false],
    ["fn f() { if !(ok) { Inner } }", "Inner", false],
    ['m!("(");\npub struct After;', "After", false],
    ["// m!(\npub struct Commented;", "Commented", false],
    ["let c = '('; pub struct Chars;", "Chars", false],
    ["fn g<'a>(x: &'a u8) {} ids!(Named);", "Named", true],
  ];
  for (const [text, needle, want] of rows) {
    assert.strictEqual(M.isInsideMacroInvocation(text, at(text, needle)), want, JSON.stringify(text));
  }
});

// ---------------------------------------------------------------------------
// C4: private tuple fields
// ---------------------------------------------------------------------------
test("a private tuple field renders as private; a public one is unchanged", () => {
  const rows = [
    ["pub struct TenantId(u128)", "TenantId", "pub struct TenantId(/* private */ u128)"],
    ["pub struct SealedId(u128)", "SealedId", "pub struct SealedId(/* private */ u128)"],
    ["pub struct OpenId(pub u128)", "OpenId", "pub struct OpenId(pub u128)"],
    ["pub struct Pair(pub u8, u16)", "Pair", "pub struct Pair(pub u8, /* private */ u16)"],
    ["pub struct Crate(pub(crate) u8)", "Crate", "pub struct Crate(pub(crate) u8)"],
    ["pub struct G<T: Into<u8>>(Vec<(T, u8)>)", "G", "pub struct G<T: Into<u8>>(/* private */ Vec<(T, u8)>)"],
    ["pub struct F(fn(u8) -> u8, u8)", "F", "pub struct F(/* private */ fn(u8) -> u8, /* private */ u8)"],
    ["pub struct Unit;", "Unit", "pub struct Unit;"],
    ["pub struct Named {\n    a: u8,\n}", "Named", "pub struct Named {\n    a: u8,\n}"],
    ["pub struct Multi(\n    u8,\n    pub u16,\n)", "Multi", "pub struct Multi(\n    /* private */ u8,\n    pub u16,\n)"],
  ];
  for (const [sig, name, want] of rows) {
    assert.strictEqual(M.markPrivateTupleFields(sig, name), want, sig);
  }
});

test("the Rust data shape carries the marker; a non-Rust def does not", () => {
  const t = (defUri) => ({ name: "OrgId", signature: "pub struct OrgId(U128)", fields: [], methods: [], methodsResolved: true, defUri });
  assert.strictEqual(M.renderDerivedDef(t(`${WS}/ids.rs`)), "pub struct OrgId(/* private */ U128)");
  assert.strictEqual(M.renderDerivedDef(t("file:///x/Org.cs")), "pub struct OrgId(U128)");
});

// ---------------------------------------------------------------------------
// The pre-fill FACADE, product transport: the payload a gesture actually sends.
// ---------------------------------------------------------------------------
const GEN_SRC = `use crate::ids::{GhostId, StreamId, TenantId};
use crate::key::StreamKey;

/// Build a \`StreamKey\` from \`TenantId\` 1, \`StreamId\` 2 and \`GhostId\` 3.
pub fn make_key() -> StreamKey {
    todo!()
}
`;

test("pre-fill facade: TenantId's members reach the prompt and GhostId is named as macro-generated", async () => {
  FILES[GEN] = GEN_SRC;
  const { ex, calls } = makeServer();
  const start = GEN_SRC.indexOf("/// Build");
  const end = GEN_SRC.indexOf("}\n", start) + 1;
  const record = {
    span: { start, end },
    signature: "pub fn make_key() -> StreamKey",
    docComment: "/// Build a `StreamKey` from `TenantId` 1, `StreamId` 2 and `GhostId` 3.",
    symbolName: "make_key",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const lines = GEN_SRC.split("\n");
  const doc = {
    uri: { toString: () => GEN },
    getText: (r) => {
      if (!r) return GEN_SRC;
      const off = (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
      return GEN_SRC.slice(off(r.start), off(r.end));
    },
    offsetAt: (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character,
    positionAt: (o) => {
      let acc = 0;
      for (let l = 0; l < lines.length; l++) {
        if (o <= acc + lines[l].length) return { line: l, character: o - acc };
        acc += lines[l].length + 1;
      }
      return { line: lines.length - 1, character: 0 };
    },
    languageId: "rust",
  };
  const logs = [];
  globalThis.__V76_FILES__ = FILES;
  globalThis.__V76_EDITS__ = 0;
  let out;
  try {
    out = await M.resolvePrefill(ex, doc, record, (l) => logs.push(l));
  } finally {
    delete globalThis.__V76_FILES__;
    delete FILES[GEN];
  }
  const dump = `\nLOGS:\n${logs.join("\n")}\nOUT:\n${out}`;
  assert.ok(out, `no payload${dump}`);
  assert.match(out, /new\(u128\) -> TenantId/, dump);
  assert.match(out, /is_sentinel\(self\) -> bool/, dump);
  assert.match(out, /TenantId\(\/\* private \*\/ u128\)/, dump);
  assert.doesNotMatch(out, /\bfmt\(|\bhash\(|\beq\(/, `trait members leaked${dump}`);
  const ghost = logs.filter((l) => l.includes("GhostId") && l.includes("macro-generated"));
  assert.strictEqual(ghost.length, 1, dump);
  assert.strictEqual(globalThis.__V76_EDITS__, 0, "no document was edited or created");
  assert.ok(!calls.some((c) => /Edit|Rename|CodeAction/.test(c.command)), "no edit-shaped command");
});
