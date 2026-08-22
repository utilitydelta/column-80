// BLIND CONTRACT ORACLE - session-v38 item 1, "render the enum".
// Written from the goal section "Item 1. Render the enum. This is the build."
// and from the facade the existing tests already declare. While
// writing this file NOTHING here read `src/vscode/fnGen.ts`,
// `src/core/crossFileShape.ts`, `src/core/dataShape.ts` or
// `src/core/compilerDirected.ts`. Harness mechanics were copied from
// test/blind-v37-p2-prefill-bounds.test.cjs, test/review-v34-prefill-cap.test.cjs
// and test/blind-v7-prepare.test.cjs, which are tests.
//
// THE CONTRACT. For each resolved candidate the pre-fill chooses between a SHAPE
// path (the resolved fields and methods plus the type's own declaration) and a
// WORKED-EXAMPLE fallback. Today the shape path is taken only when the resolver
// derived at least one field or at least one method. A Rust enum satisfies
// neither: its hover has no `name: Type` lines so fields is empty, and its
// variants arrive from documentSymbol with no signature and are all dropped so
// methods is empty. A pure data enum therefore falls to the worked-example leg,
// which usually has nothing, and injects zero bytes - while the whole
// declaration, variants included, is already sitting in the derived type's
// `signature`.
//
// THE CHANGE. For RUST ONLY, the shape path is additionally taken when the
// derived signature IS AN ENUM DECLARATION, at zero fields and zero methods. The
// injection must then carry the declaration with its variant names.
//
// THE HAZARD IT MUST NOT REOPEN. A library struct hovered as
// `pub struct Foo { /* private fields */ }` also derives an empty shape.
// Injecting a stub for it points the model at a surface that does not exist,
// which is strictly worse than injecting nothing, and that type must keep
// falling through to the worked-example leg. This is the long-standing F2 rule,
// frozen in test/blind-v7-prepare.test.cjs. The admission is on the signature
// being an ENUM DECLARATION, never on empty-shape types generally.
//
// THE OTHER FOUR LANGUAGES. typescript, csharp, python and go do not change.
// Section D feeds each of them the EXACT signature string that admits under
// Rust, which is the only lever that can tell a Rust-gated fix from a
// language-blind one.
//
// EXPECTED RED, and MEASURED RED, against commit 0482bf3 with
// `src/vscode/fnGen.ts` exactly as committed (run in a detached worktree so an
// in-flight edit could not colour the baseline). Each of these must pass after
// the build:
//   A1   rust, pure data enum, no worked example available -> renders
//   A2   rust, pure data enum, a worked example IS available -> shape still wins
//   A3   rust, pure data enum, the shape block is not the usage-example block
//   A4   rust, an UNPREFIXED `enum Foo {` declaration admits as well as `pub enum`
//   E1b  rust, the minimal pair: one name, one fixture, only the head token moves
//
// EXPECTED GREEN, and MEASURED GREEN on that same baseline. Each must STAY green:
//   guard  the bundle builds
//   B1  rust, empty-shape struct with an example -> worked example, no shape
//   B2  rust, empty-shape struct with NO example -> nothing at all
//   C1  rust, an enum that carries methods renders today
//   C2  and it renders exactly these bytes (frozen from the pre-build run)
//   D1..D4  typescript, go, csharp, python: an enum-declaration signature with an
//           empty shape renders nothing, before the build and after it
//   E1  rust, a struct whose signature merely CONTAINS "enum" is not admitted
//   E2  rust (contested), a bodyless `pub enum Foo` head admits nothing
//
// AND ONE THING THE BASELINE RUN FOUND, 2026-08-03. An UNCOMMITTED change to
// `src/vscode/fnGen.ts` was already present in the working tree while this file
// was being written. Against it A1, A2, A3, A4 and E1b pass, which is the build
// landing, and E2 FAILS: that change admits `pub enum Verdict` with no body at
// all, injecting a declaration head with zero variants plus the firm "call ONLY
// methods that appear in the API surface above" instruction over an empty
// surface. That is the F2 hazard shape wearing the enum keyword, and it is the
// one row of this file the in-flight version does not satisfy.
//
// E2 IS CONTESTED AND THE BUILDER SHOULD READ IT BEFORE MAKING IT GREEN. The
// contract admits "an enum declaration" and separately requires the injection to
// contain "the variant names". A hover that is only `pub enum Foo` with no body
// satisfies the first and cannot satisfy the second, and a declaration head with
// no variants is the same empty stub the hazard rule refuses. This file reads
// that as a refusal. If the build decides otherwise it is a contract change and
// belongs in writing, not in a quiet edit to this row.
//
// PROVENANCE OF THE FIXTURES. The two Rust enum hovers are MEASURED, lifted from
// the same captures test/blind-v37-p5-tuple-payload.test.cjs quotes:
// `BasicConstraints` from the live `create_ca` capture and `DecodeError` from
// the Rust elision spike. `DecodeError` is the goal's own named
// example of an enum that renders today only because its `impl Display` happens
// to fill `methods`. The empty-shape struct hover is the F2 fixture. Everything
// labelled SYNTHESIZED below says so and says why.
//
// Run: SKIP_LIVE=1 node --test test/blind-v38-p1-enum-render.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. `resolvePrefill` bundled headless against a STRUCTURAL vscode stub -
// real Position/Range with contains/compareTo so a tree walk that does span math
// runs honestly. `workspace.openTextDocument` serves a uri->text map through a
// process global, which is what lets the cross-file walk read a def file.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v38-p1-vscode-stub.cjs");
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
      const files = globalThis.__V38P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v38-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v38-p1.bundle.cjs");
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

// A broken bundle must be ONE loud failure, never a wall of TypeErrors a reader
// could mistake for contract failures.
test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const show = (v) => JSON.stringify(v);

// ===========================================================================
// Fixtures.
// ===========================================================================

const WS = "file:///work/v38p1";

// MEASURED. The live `create_ca` capture, under the
// header "Data shape of `BasicConstraints`". A PURE DATA enum: no `name: Type`
// line anywhere, so zero fields, and no methods supplied below, so zero methods.
// This is exactly the type the goal says injects zero bytes today.
const HOVER_BASIC_CONSTRAINTS = [
  "pub enum BasicConstraints {",
  "    Unconstrained,",
  "    Constrained( /* … */ ),",
  "}",
].join("\n");
const SRC_BASIC_CONSTRAINTS = ["pub enum BasicConstraints {", "    Unconstrained,", "    Constrained(u8),", "}", ""].join("\n");
const BASIC_VARIANTS = ["Unconstrained", "Constrained"];

// MEASURED. From the Rust elision spike, base64::DecodeError, the
// goal's own named case: it renders TODAY, and not because it is an enum. It
// carries an `impl Display`, so `methods` is non-empty and the existing gate
// happens to pass.
const HOVER_DECODE_ERROR = [
  "pub enum DecodeError {",
  "    InvalidByte( /* … */ ),",
  "    InvalidLength( /* … */ ),",
  "    InvalidLastSymbol( /* … */ ),",
  "    InvalidPadding,",
  "}",
].join("\n");
const SRC_DECODE_ERROR = [
  "pub enum DecodeError {",
  "    InvalidByte(usize, u8),",
  "    InvalidLength(usize),",
  "    InvalidLastSymbol(usize, u8),",
  "    InvalidPadding,",
  "}",
  "",
  "impl fmt::Display for DecodeError {",
  "    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }",
  "}",
  "",
].join("\n");
const DECODE_VARIANTS = ["InvalidByte", "InvalidLength", "InvalidLastSymbol", "InvalidPadding"];

// The F2 hazard fixture, taken verbatim from test/blind-v7-prepare.test.cjs.
const HOVER_PRIVATE_STRUCT = "pub struct Opaque { /* private fields */ }";
const SRC_PRIVATE_STRUCT = "pub struct Opaque { /* private fields */ }\n";

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

function makeExtractor(files, defTypes, examples) {
  const known = new Set(Object.keys(defTypes));
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [] };
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
    calls,
    ext: {
      definition: async (c) => {
        calls.definition.push(c);
        const t = typeAtCursor(c.uri, c);
        return t ? defLocFor(t) : undefined;
      },
      hoverSurface: async (c) => {
        calls.hoverSurface.push(c);
        const t = typeAtCursor(c.uri, c);
        const h = t ? defTypes[t].hover : undefined;
        return h ? { signature: h } : undefined;
      },
      membersOfType: async (c) => {
        calls.membersOfType.push(c);
        const t = typeAtCursor(c.uri, c);
        return (t && defTypes[t].members) || [];
      },
      example: async (c, prefer) => {
        calls.example.push({ cursor: c, prefer });
        return examples[prefer];
      },
      completeMembers: async () => [],
      qualifyImport: async () => undefined,
    },
  };
}

const FIXTURES = {
  rust: {
    ext: "rs",
    symbol: "decide",
    docLine: "/// Decide the outcome.",
    signature: (n) => `pub fn decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
  },
  typescript: {
    ext: "ts",
    symbol: "decide",
    docLine: "/** Decide the outcome. */",
    signature: (n) => `export function decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
  },
  csharp: {
    // PascalCase on purpose: the C# candidate rule reads the leading token of
    // `public uint Decide(...)` as a type, so a lowercase name would be a shape
    // no .NET file has. Same reasoning as blind-v37-p2.
    ext: "cs",
    symbol: "Decide",
    docLine: "/// <summary>Decide the outcome.</summary>",
    signature: (n) => `public uint Decide(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
  },
  python: {
    ext: "py",
    symbol: "decide",
    docLine: '"""Decide the outcome."""',
    signature: (n) => `def decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
  },
  go: {
    ext: "go",
    symbol: "Decide",
    docLine: "// Decide the outcome.",
    signature: (n) => `func Decide(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
  },
};

// The types the payload actually rendered a block for, read the way a reader
// would: a name in backticks on a header line immediately above a fenced block.
// Header-agnostic on purpose, so a row does not go red because a block header was
// reworded.
function renderedTypes(out) {
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

// `types`: [{ name, hover, src, members?, example? }] in signature order.
async function runPrefill(languageId, types) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const names = types.map((t) => t.name);
  const signature = F.signature(names);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  const examples = {};
  for (const t of types) {
    const uri = `${WS}/${t.name.toLowerCase()}.${F.ext}`;
    files[uri] = t.src;
    defTypes[t.name] = { uri, hover: t.hover, members: t.members || [] };
    if (t.example !== undefined) examples[t.name] = t.example;
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Decide the outcome.",
    symbolName: F.symbol,
    languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: F.bodyIndent,
    docstringRefusal: undefined,
  };
  const logs = [];
  const { ext, calls } = makeExtractor(files, defTypes, examples);
  globalThis.__V38P1_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, mainUri), record, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V38P1_FILES__;
  }
  return { text: out || "", logs, calls, names: renderedTypes(out || "") };
}

const dump = (r) => `\n  RENDERED=${show(r.names)}\n  LOGS=${show(r.logs)}\n  PAYLOAD:\n${r.text}`;

// "The type reached the model" is a rendered block, whatever the block is called.
// "It reached it down the EXAMPLE leg" is the usage-example header, which is the
// one header this repo has used unchanged since v7 and which the F2 row already
// binds to.
const rendered = (r, n) => r.names.includes(n);
const viaExample = (r, n) => new RegExp("Usage example for `" + n + "`").test(r.text);

// ===========================================================================
// A. THE BUILD. A Rust pure data enum reaches the model, with its variants.
// ===========================================================================

btest("A1 [rust]: a pure data enum with zero fields and zero methods RENDERS, variants included", async () => {
  // No worked example is supplied, which is the real-corpus case: the goal
  // reports 171 drop lines carrying the `, and no worked example` tail. So today
  // this type injects zero bytes and everything below fails.
  const r = await runPrefill("rust", [
    { name: "BasicConstraints", hover: HOVER_BASIC_CONSTRAINTS, src: SRC_BASIC_CONSTRAINTS, members: [] },
  ]);
  assert.ok(
    rendered(r, "BasicConstraints"),
    `a pure data enum must reach the model. Zero fields and zero methods is what an enum ALWAYS ` +
      `derives, and the whole declaration is already held in the derived type's signature.${dump(r)}`,
  );
  assert.ok(
    /\benum\s+BasicConstraints\b/.test(r.text),
    `the injected text must carry the enum's own declaration, not a paraphrase of it.${dump(r)}`,
  );
  for (const v of BASIC_VARIANTS) {
    assert.ok(
      new RegExp(`\\b${v}\\b`).test(r.text),
      `variant ${show(v)} must be in front of the model. Inventing variants is what E0599 at 89 rows ` +
        `and E0433 at 44 look like, and the variant names are the payload.${dump(r)}`,
    );
  }
});

btest("A2 [rust]: the same enum with a worked example available still takes the SHAPE path", async () => {
  // The contract calls the worked example a FALLBACK. When both are available the
  // declaration wins, because the declaration is the complete surface and the
  // example is one use of it. This row also separates "the enum rendered" from
  // "the example leg happened to have something", which A1 cannot do.
  const r = await runPrefill("rust", [
    {
      name: "BasicConstraints",
      hover: HOVER_BASIC_CONSTRAINTS,
      src: SRC_BASIC_CONSTRAINTS,
      members: [],
      example: "let bc = BasicConstraints::Unconstrained;",
    },
  ]);
  assert.ok(rendered(r, "BasicConstraints"), `the enum must render.${dump(r)}`);
  assert.ok(
    /\benum\s+BasicConstraints\b/.test(r.text),
    `and it must render as the DECLARATION. A payload that contains only the example line is the ` +
      `pre-change behaviour with a fixture that happened to have an example.${dump(r)}`,
  );
});

btest("A3 [rust]: the enum arrives down the shape leg, not the worked-example leg", async () => {
  const r = await runPrefill("rust", [
    {
      name: "BasicConstraints",
      hover: HOVER_BASIC_CONSTRAINTS,
      src: SRC_BASIC_CONSTRAINTS,
      members: [],
      example: "let bc = BasicConstraints::Unconstrained;",
    },
  ]);
  assert.ok(
    !viaExample(r, "BasicConstraints"),
    `the two legs are a choice, not a pair. An enum that renders BOTH the declaration and a usage ` +
      `example spends the byte budget twice on the same type, and the goal's arm measured 122 extra ` +
      `bytes per row, not two blocks per enum.${dump(r)}`,
  );
});

btest("A4 [rust]: an UNPREFIXED enum declaration admits too, not just `pub enum`", async () => {
  // A private enum in the same crate is the commonest enum in a codebase and its
  // hover has no `pub`. A gate written against the literal string "pub enum"
  // passes A1 and misses most of the corpus. SYNTHESIZED hover: the measured
  // hovers in this repo are all `pub`, and the un-prefixed form is the same
  // string with the modifier removed.
  const HOVER = ["enum Verdict {", "    Pass,", "    Fail,", "    Skipped,", "}"].join("\n");
  const SRC = HOVER + "\n";
  const r = await runPrefill("rust", [{ name: "Verdict", hover: HOVER, src: SRC, members: [] }]);
  assert.ok(rendered(r, "Verdict"), `a crate-private enum must render as readily as a public one.${dump(r)}`);
  for (const v of ["Pass", "Fail", "Skipped"]) {
    assert.ok(new RegExp(`\\b${v}\\b`).test(r.text), `variant ${show(v)} must be present.${dump(r)}`);
  }
});

// ===========================================================================
// B. THE HAZARD. An empty-shape STRUCT is still refused. This is the row that
// catches an over-wide fix, and it is GREEN today: it is the F2 rule from
// test/blind-v7-prepare.test.cjs, restated here because item 1 walks past it.
// ===========================================================================

btest("B1 [rust]: an empty-shape library struct still falls through to the worked example", async () => {
  const r = await runPrefill("rust", [
    {
      name: "Opaque",
      hover: HOVER_PRIVATE_STRUCT,
      src: SRC_PRIVATE_STRUCT,
      members: [],
      example: "let o = ext::Opaque::with_capacity(1024);",
    },
  ]);
  assert.ok(
    viaExample(r, "Opaque"),
    `precondition: the empty-shape struct must still reach the example leg, or this row is measuring ` +
      `something else.${dump(r)}`,
  );
  assert.ok(
    !/struct\s+Opaque/.test(r.text),
    `the private-fields stub must NOT be injected as a data shape. It names a surface that does not ` +
      `exist, which is strictly worse than injecting nothing. The enum admission is on the signature ` +
      `being an enum declaration, NOT on empty-shape types generally.${dump(r)}`,
  );
});

btest("B2 [rust]: an empty-shape struct with NO worked example injects nothing at all", async () => {
  // The sharper half of the hazard. B1 can be satisfied by a fix that renders the
  // stub AND the example. With no example available there is nowhere to hide: the
  // correct payload for this type is zero bytes.
  const r = await runPrefill("rust", [
    { name: "Opaque", hover: HOVER_PRIVATE_STRUCT, src: SRC_PRIVATE_STRUCT, members: [] },
  ]);
  assert.ok(
    !rendered(r, "Opaque"),
    `nothing renderable and no worked example means no block. A fix that admits any empty shape ` +
      `reopens the hazard here even when B1 stays green.${dump(r)}`,
  );
  assert.ok(!/struct\s+Opaque/.test(r.text), `and the stub declaration must not appear anywhere.${dump(r)}`);
});

// ===========================================================================
// C. NO REGRESSION. The enum that already rendered still renders.
// ===========================================================================

btest("C1 [rust]: an enum that carries methods renders as it does today", async () => {
  // `DecodeError` is the goal's own example: it renders now because its
  // `impl Display` fills `methods`, so the existing gate happens to pass. The
  // change must not move it.
  const r = await runPrefill("rust", [
    {
      name: "DecodeError",
      hover: HOVER_DECODE_ERROR,
      src: SRC_DECODE_ERROR,
      members: [{ name: "fmt", kind: "method", signature: "fmt(&self, f: &mut fmt::Formatter) -> fmt::Result" }],
    },
  ]);
  assert.ok(rendered(r, "DecodeError"), `it rendered before the change and must render after.${dump(r)}`);
  assert.ok(/\benum\s+DecodeError\b/.test(r.text), `with its declaration.${dump(r)}`);
  assert.ok(/\bfmt\(/.test(r.text), `and with its method, which is the reason it rendered at all today.${dump(r)}`);
  for (const v of DECODE_VARIANTS) {
    assert.ok(new RegExp(`\\b${v}\\b`).test(r.text), `variant ${show(v)} must survive.${dump(r)}`);
  }
});

// The frozen bytes. Captured from a run of THIS file against the pre-build
// working tree on 2026-08-03, before any item-1 change existed. "Unchanged" for a
// type that already rendered is a byte claim and nothing weaker can make it.
// If this row goes red the build moved a payload it was told not to touch; the
// diff in the failure message is the evidence, and re-baselining it is a decision
// to be argued in writing, not a quiet edit.
const C2_FROZEN = fs.readFileSync(path.join(__dirname, "fixtures", "v38-p1-decodeerror-payload.txt"), "utf8");

btest("C2 [rust]: and it renders those bytes EXACTLY, frozen from the pre-build run", async () => {
  const r = await runPrefill("rust", [
    {
      name: "DecodeError",
      hover: HOVER_DECODE_ERROR,
      src: SRC_DECODE_ERROR,
      members: [{ name: "fmt", kind: "method", signature: "fmt(&self, f: &mut fmt::Formatter) -> fmt::Result" }],
    },
  ]);
  assert.equal(
    r.text,
    C2_FROZEN,
    `the methods-carrying enum's payload must be byte-identical across item 1.\n--- FROZEN ---\n${C2_FROZEN}\n--- NOW ---\n${r.text}\n--- END ---`,
  );
});

// ===========================================================================
// D. THE OTHER FOUR LANGUAGES ARE UNTOUCHED.
//
// Each row feeds its language a type whose hover IS an enum declaration and
// whose shape is empty. The Rust rows above prove that exact string admits under
// Rust, so a fix that reads the signature without asking which language it came
// from turns these four red. That is the only lever that can tell the two apart
// from outside, and it is why the fixture is the same string in all four rather
// than each language's idiomatic enum.
//
// Zero members on purpose. C# reaches its enum variants by a different route
// (the `enumMemberLine` hook in crossFileShape), and a fixture that handed C#
// signature-less members would be measuring that hook instead of this gate.
//
// EACH ROW CARRIES ITS OWN NON-VACUITY CONTROL, and it needs one: an assertion
// that a language renders nothing is satisfied for free by a harness that cannot
// drive that language at all. The control is the SAME fixture with one method
// member added, which must render. Measured: without it, go, csharp and python
// render nothing for ANY hover this file feeds them, and D2, D3 and D4 would
// have been three green rows saying nothing.
// ===========================================================================

const FOREIGN_ENUM_HOVER = ["enum Color {", "    Red,", "    Green,", "    Blue,", "}"].join("\n");
const FOREIGN_ENUM_SRC = FOREIGN_ENUM_HOVER + "\n";

for (const [row, languageId] of [
  ["D1", "typescript"],
  ["D2", "go"],
  ["D3", "csharp"],
  ["D4", "python"],
]) {
  btest(`${row} [${languageId}]: an enum-declaration signature with an empty shape renders NOTHING, before and after`, async () => {
    const control = await runPrefill(languageId, [
      {
        name: "Color",
        hover: FOREIGN_ENUM_HOVER,
        src: FOREIGN_ENUM_SRC,
        members: [{ name: "label", kind: "method", signature: "label(): string" }],
      },
    ]);
    assert.ok(
      rendered(control, "Color"),
      `${languageId}: NON-VACUITY CONTROL. The same fixture with one method member must render, or ` +
        `this harness cannot drive ${languageId} at all and the row below is green for free.${dump(control)}`,
    );
    const r = await runPrefill(languageId, [
      { name: "Color", hover: FOREIGN_ENUM_HOVER, src: FOREIGN_ENUM_SRC, members: [] },
    ]);
    assert.ok(
      !rendered(r, "Color"),
      `${languageId} is out of scope for session-v38 and must be byte-identical. This is the exact ` +
        `signature string that admits under Rust, so a block here means the gate is language-blind. ` +
        `Go, Python and TypeScript need their own measurement and C# already has its own route.${dump(r)}`,
    );
    assert.ok(
      !/\bRed\b/.test(r.text) && !/\bGreen\b/.test(r.text) && !/\bBlue\b/.test(r.text),
      `${languageId}: and no variant name may leak into the payload by any other route.${dump(r)}`,
    );
  });
}

// ===========================================================================
// E. WORD-BOUNDARY AND DECLARATION-HEAD DISCIPLINE.
// ===========================================================================

btest("E1 [rust]: a struct whose signature merely CONTAINS the word enum is not admitted", async () => {
  // Three hostile shapes in one row, each an empty-shape struct that must keep
  // falling through. SYNTHESIZED: these are adversarial inputs for a substring
  // test, not claims about how rust-analyzer writes hovers. The first two are
  // ordinary type names; the third puts a lowercase `enum ` with a real word
  // boundary AND a following identifier inside the hover's own comment, which is
  // where a `\benum\s+\w+` regex over the whole signature still matches and a
  // rule anchored on the declaration head does not.
  const CASES = [
    ["EnumRegistry", "pub struct EnumRegistry { /* private fields */ }"],
    ["Enumerator", "pub struct Enumerator { /* private fields */ }"],
    ["Shadow", "pub struct Shadow { /* private fields, mirrors enum Verdict */ }"],
  ];
  for (const [name, hover] of CASES) {
    const r = await runPrefill("rust", [{ name, hover, src: hover + "\n", members: [] }]);
    assert.ok(
      !rendered(r, name),
      `${name}: the admission is on the signature BEING an enum declaration. A substring or a loose ` +
        `word match admits an empty-shape struct and reopens the hazard the gate exists for.${dump(r)}`,
    );
    assert.ok(!/struct\s+\w+\s*\{/.test(r.text), `${name}: and no stub declaration may appear.${dump(r)}`);
  }
});

btest("E1b [rust]: the minimal pair - one name, one fixture, only the head token moves", async () => {
  // E1's refusals are over-determined: `{ /* private fields */ }` was already
  // refused before this session, so those rows cannot say WHICH rule refused
  // them. This pair can. Same candidate name, same file layout, same empty
  // shape; the only difference is `struct` against `enum` and a variant list.
  // The struct must stay out and the enum must come in, and no rule that admits
  // both or refuses both can satisfy this row.
  const NAME = "EnumRegistry";
  const asStruct = await runPrefill("rust", [
    { name: NAME, hover: `pub struct ${NAME} { /* private fields */ }`, src: `pub struct ${NAME} { /* private fields */ }\n`, members: [] },
  ]);
  const asEnum = await runPrefill("rust", [
    { name: NAME, hover: `pub enum ${NAME} {\n    Alpha,\n    Beta,\n}`, src: `pub enum ${NAME} {\n    Alpha,\n    Beta,\n}\n`, members: [] },
  ]);
  assert.ok(!rendered(asStruct, NAME), `the struct half of the pair must be refused.${dump(asStruct)}`);
  assert.ok(rendered(asEnum, NAME), `the enum half of the pair must be admitted.${dump(asEnum)}`);
  assert.ok(
    /\bAlpha\b/.test(asEnum.text) && /\bBeta\b/.test(asEnum.text),
    `with its variants, which is the payload the whole item exists to deliver.${dump(asEnum)}`,
  );
});

btest("E2 [rust] CONTESTED: a bodyless `pub enum` head with no variants admits nothing", async () => {
  // Read the header before making this green. The contract admits "an enum
  // declaration" and requires the injection to carry "the variant names". A
  // hover that is only the head carries none, so admitting it injects a name the
  // model already has and a surface it cannot use - the same empty stub the
  // hazard rule refuses, wearing the enum keyword. This file reads that as a
  // refusal. A build that decides the other way is changing the contract and
  // owes a written reason.
  const r = await runPrefill("rust", [
    { name: "Verdict", hover: "pub enum Verdict", src: "pub enum Verdict { Pass, Fail }\n", members: [] },
  ]);
  assert.ok(
    !rendered(r, "Verdict"),
    `a declaration HEAD is not a declaration. Zero variants is zero surface, and the payload item 1 ` +
      `exists to deliver is the variant names.${dump(r)}`,
  );
});
