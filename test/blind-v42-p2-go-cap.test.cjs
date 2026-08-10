// BLIND-STYLE CONTRACT - session-v42 phase 2: the per-language type cap.
//
// THE CONTRACT: Go's injected-type cap is 8, measured on the authored-gesture
// funnel (the cap was the binding stage; ladder in session-v42/funnel-report
// addendum). Rust STAYS at 4 - its own 4->12 arm measured flat (v37 item 3),
// and its frozen prompt-identity oracles pin the bytes. The observable, per
// language, through resolvePrefill with six same-file types on offer:
//   go:   more than four types disclose (impossible under an inherited cap 4)
//   rust: exactly four disclose, and the cap line names the two dropped
//
// Run: SKIP_LIVE=1 node --test test/blind-v42-p2-go-cap.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".blind-v42-p2-vscode-stub.cjs");
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
      const files = globalThis.__BLIND42P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);
const ENTRY = path.join(__dirname, ".blind-v42-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v42-p2.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: resolvePrefill builds headless", () => {
  if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle broken");
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
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
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

// A same-file six-type fixture per language: every type anchors at its own
// declaration, resolves a hover and one member, so nothing but the CAP can
// hold a type back.
function makeExtractor(files, defTypes) {
  const known = new Set(Object.keys(defTypes));
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const lines = files[defTypes[t].uri].split("\n");
      const ln = lines.findIndex((l) => defTypes[t].declRe.test(l));
      const ch = Math.max(0, lines[ln]?.indexOf(t) ?? 0);
      return { uri: defTypes[t].uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      return t ? defTypes[t].members : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

async function run(languageId, src, uri, record, defTypes) {
  const files = { [uri]: src };
  const logs = [];
  const disclosed = [];
  globalThis.__BLIND42P2_FILES__ = files;
  try {
    await resolvePrefill(makeExtractor(files, defTypes), makeDoc(src, uri), record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d.map((x) => x.name)),
    });
  } finally {
    delete globalThis.__BLIND42P2_FILES__;
  }
  return { logs, disclosed };
}

const NAMES = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Fox"];

btest("go: six doc-named same-file types all hold slots - the cap is 8, not an inherited 4", async () => {
  const uri = "file:///work/v42p2/main.go";
  const decls = NAMES.map((n) => `type ${n} struct {\n\tN int\n}`).join("\n\n");
  const src = [
    "package app",
    "",
    decls,
    "",
    "// Decide implements the committed behaviour.",
    `// It works with ${NAMES.map((n) => "`" + n + "`").join(", ")}.`,
    "func Decide() int {",
    "\treturn 0",
    "}",
    "",
  ].join("\n");
  const defTypes = {};
  for (const n of NAMES) {
    defTypes[n] = {
      uri,
      declRe: new RegExp(`^type ${n} struct`),
      hover: `type ${n} struct {\n\tN int\n}`,
      members: [{ name: "Do", kind: "method", signature: `Do() ${n}` }],
    };
  }
  const record = {
    span: { start: src.indexOf("func Decide"), end: src.length - 2 },
    signature: "func Decide() int",
    docComment: `// Decide implements the committed behaviour.\n// It works with ${NAMES.map((n) => "`" + n + "`").join(", ")}.`,
    symbolName: "Decide",
    languageId: "go",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "\t",
  };
  const r = await run("go", src, uri, record, defTypes);
  assert.ok(
    r.disclosed.length > 4,
    `six anchorable gesture types and only ${r.disclosed.length} disclosed (${r.disclosed.join(", ")}): ` +
      `the Go cap regressed to the inherited 4.\nLOGS:\n${r.logs.join("\n")}`,
  );
  assert.ok(
    !r.logs.some((l) => /dropped \d+ lower-priority/.test(l)),
    `six types fit under cap 8; nothing may be cap-dropped.\nLOGS:\n${r.logs.join("\n")}`,
  );
});

btest("rust CONTROL: six doc-named same-file types still cap at 4 - Rust's measured value is untouched", async () => {
  const uri = "file:///work/v42p2/main.rs";
  const decls = NAMES.map((n) => `pub struct ${n} {\n    pub n: u32,\n}`).join("\n\n");
  const src = [
    decls,
    "",
    "/// Decide implements the committed behaviour.",
    `/// It works with ${NAMES.map((n) => "`" + n + "`").join(", ")}.`,
    "pub fn decide() -> u32 {",
    "    todo!()",
    "}",
    "",
  ].join("\n");
  const defTypes = {};
  for (const n of NAMES) {
    defTypes[n] = {
      uri,
      declRe: new RegExp(`^pub struct ${n} `),
      hover: `pub struct ${n} {\n    pub n: u32,\n}`,
      members: [{ name: "get", kind: "method", signature: `get(&self) -> u32` }],
    };
  }
  const record = {
    span: { start: src.indexOf("pub fn decide"), end: src.length - 2 },
    signature: "pub fn decide() -> u32",
    docComment: `Decide implements the committed behaviour.\nIt works with ${NAMES.map((n) => "`" + n + "`").join(", ")}.`,
    symbolName: "decide",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  const r = await run("rust", src, uri, record, defTypes);
  assert.equal(
    r.disclosed.length,
    4,
    `Rust stays at its measured cap of 4 (got ${r.disclosed.length}: ${r.disclosed.join(", ")}).\nLOGS:\n${r.logs.join("\n")}`,
  );
  assert.ok(
    r.logs.some((l) => /dropped 2 lower-priority type\(s\)/.test(l)),
    `the two evictions stay named in the channel.\nLOGS:\n${r.logs.join("\n")}`,
  );
});
