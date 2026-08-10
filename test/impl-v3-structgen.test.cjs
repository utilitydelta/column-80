// Implementer oracle: v3 structure generation (goal item 1). Proves the
// vscode-layer resolution admits Struct/Enum (gated on compilerDirectedInjection),
// walks up from a Field/EnumMember cursor to the container, no-ops a brace-less
// unit/tuple struct, and carries the resolved `kind` through; the boundary
// invariant over a struct AND an enum computed from the REAL resolved span; the
// service threading `kind` into the type-shaped prompt; and the fn-shaped
// extraction/postprocess handling a type body (header-anchored, top-level
// closing brace at column 0, trailing items trimmed).
//
// Run: SKIP_LIVE=1 node --test test/impl-v3-structgen.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- vscode stub with the type kinds the resolver now admits ------------
const STUB = path.join(__dirname, ".impl-v3-structgen-stub.cjs");
fs.writeFileSync(
  STUB,
  `
const state = {
  config: {}, messages: [], warnResponses: [], commands: {}, executeCalls: [],
  symbols: undefined, activeTextEditor: undefined,
};
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  contains(p) {
    const afterStart = p.line > this.start.line || (p.line === this.start.line && p.character >= this.start.character);
    const beforeEnd = p.line < this.end.line || (p.line === this.end.line && p.character <= this.end.character);
    return afterStart && beforeEnd;
  }
}
class EventEmitter { constructor(){ this.h=[]; } get event(){ return (fn)=>{ this.h.push(fn); return {dispose(){}}; }; } fire(x){ for (const f of this.h) f(x); } dispose(){} }
class WorkspaceEdit { replace() {} }
const Uri = { from: (o) => ({ ...o, toString: () => o.scheme + "://" + o.path + "?" + (o.query ?? "") }) };
// Real vscode.SymbolKind numbering, so the fixtures speak the same values the resolver compares.
const SymbolKind = { Method: 5, Field: 7, Constructor: 8, Enum: 9, Function: 11, EnumMember: 21, Struct: 22 };
module.exports = {
  __state: state,
  Position, Range, EventEmitter, WorkspaceEdit, Uri, SymbolKind,
  ProgressLocation: { Notification: 15 },
  TabInputTextDiff: class {},
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in state.config ? state.config[key] : fallback),
      inspect: () => undefined,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    get textDocuments() { return []; },
    applyEdit: async () => true,
  },
  window: {
    get activeTextEditor() { return state.activeTextEditor; },
    showInformationMessage: async (message, ...a) => { state.messages.push({ kind: "info", message, a }); return undefined; },
    showWarningMessage: async (message, ...a) => { state.messages.push({ kind: "warn", message, a }); return state.warnResponses.shift(); },
    showErrorMessage: async (message) => { state.messages.push({ kind: "error", message }); },
    withProgress: async (opts, task) => task({ report: () => {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    tabGroups: { all: [], onDidChangeTabs: () => ({ dispose() {} }), close: async () => {} },
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...args) => {
      state.executeCalls.push({ id, args });
      if (id === "vscode.executeDocumentSymbolProvider") return state.symbols;
      return undefined;
    },
  },
};
`,
);

const entry = path.join(__dirname, ".impl-v3-structgen.entry.ts");
const outfile = path.join(__dirname, ".impl-v3-structgen.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { resolveFunctionAtCursor, registerFnGen } from "../src/vscode/fnGen";
export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { FnGenService } from "../src/core/fnGenService";
export { ContextBlockStore } from "../src/core/contextBlocks";
export { assembleFnGenPrompt } from "../src/core/prompt";
export { assembleRepairPrompt } from "../src/core/repair";
export { spliceSpan, byteCompareOutsideSpan } from "../src/core/span";
export { extractRequestedFunction, postprocessInstructOutput } from "../src/core/instructPostprocess";
export { Position, Range, SymbolKind, __state } from "vscode";\n`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const {
  resolveFunctionAtCursor, registerFnGen, resolveSurfaceInjection, FnGenService, ContextBlockStore,
  assembleFnGenPrompt, assembleRepairPrompt, spliceSpan, byteCompareOutsideSpan,
  extractRequestedFunction, postprocessInstructOutput,
  Position, Range, SymbolKind, __state,
} = require(outfile);
test.after(() => {
  for (const f of [entry, outfile, STUB]) fs.rmSync(f, { force: true });
});

// ---- a headless document backed by an in-memory string ------------------
function makeDoc(text) {
  const lineStart = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStart.push(i + 1);
  const offsetOf = (line, character) => lineStart[line] + character;
  return {
    languageId: "rust",
    version: 1,
    uri: { path: "/x.rs", toString: () => "file:///x.rs" },
    getText(range) {
      if (!range) return text;
      return text.slice(offsetOf(range.start.line, range.start.character), offsetOf(range.end.line, range.end.character));
    },
    offsetAt(pos) { return offsetOf(pos.line, pos.character); },
    positionAt(off) {
      let line = 0;
      while (line + 1 < lineStart.length && lineStart[line + 1] <= off) line++;
      return new Position(line, off - lineStart[line]);
    },
    lineAt(line) {
      const t = text.split("\n")[line] ?? "";
      return { text: t, firstNonWhitespaceCharacterIndex: t.length - t.trimStart().length };
    },
  };
}
const posAt = (text, off) => {
  const pre = text.slice(0, off);
  const line = pre.split("\n").length - 1;
  return new Position(line, off - (pre.lastIndexOf("\n") + 1));
};
const rangeFor = (text, startOff, endOff) => new Range(posAt(text, startOff), posAt(text, endOff));

// ---- fixtures -----------------------------------------------------------
const STRUCT_SRC = `//! Fixture module.

pub fn before(x: i64) -> i64 {
    x + 1
}

/// Configuration for the server.
///
/// Holds the bind address and the port.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub addr: String,
    pub port: u16,
}

pub fn after(x: i64) -> i64 {
    x - 1
}
`;

const ENUM_SRC = `//! Fixture module.

/// A protocol message.
pub enum Message {
    Request(String),
    Response { code: u16 },
    Heartbeat,
}

pub fn tail() {}
`;

const UNIT_SRC = `/// A type-level marker.
pub struct Marker;
`;

const TUPLE_SRC = `/// Wraps a raw id.
pub struct Id(pub u64);
`;

function structSymbols() {
  const t = STRUCT_SRC;
  const docOff = t.indexOf("/// Configuration");
  const closeOff = t.indexOf("}", t.indexOf("pub port")) + 1;
  const nameOff = t.indexOf("ServerConfig", t.indexOf("pub struct"));
  const addrOff = t.indexOf("    pub addr");
  const portOff = t.indexOf("    pub port");
  return [
    {
      name: "ServerConfig", kind: SymbolKind.Struct,
      range: rangeFor(t, docOff, closeOff),
      selectionRange: rangeFor(t, nameOff, nameOff + "ServerConfig".length),
      children: [
        { name: "addr", kind: SymbolKind.Field, range: rangeFor(t, addrOff, t.indexOf("\n", addrOff)), selectionRange: rangeFor(t, addrOff, addrOff + 8), children: [] },
        { name: "port", kind: SymbolKind.Field, range: rangeFor(t, portOff, t.indexOf("\n", portOff)), selectionRange: rangeFor(t, portOff, portOff + 8), children: [] },
      ],
    },
  ];
}

function enumSymbols() {
  const t = ENUM_SRC;
  const docOff = t.indexOf("/// A protocol");
  const closeOff = t.indexOf("}", t.indexOf("Heartbeat")) + 1;
  const nameOff = t.indexOf("Message", t.indexOf("pub enum"));
  const reqOff = t.indexOf("    Request");
  return [
    {
      name: "Message", kind: SymbolKind.Enum,
      range: rangeFor(t, docOff, closeOff),
      selectionRange: rangeFor(t, nameOff, nameOff + "Message".length),
      children: [
        { name: "Request", kind: SymbolKind.EnumMember, range: rangeFor(t, reqOff, t.indexOf("\n", reqOff)), selectionRange: rangeFor(t, reqOff, reqOff + 11), children: [] },
      ],
    },
  ];
}

function unitSymbols(src, name) {
  const docOff = 0;
  const endOff = src.indexOf(";") + 1;
  const nameOff = src.indexOf(name, src.indexOf("pub struct"));
  return [{
    name, kind: SymbolKind.Struct,
    range: rangeFor(src, docOff, endOff),
    selectionRange: rangeFor(src, nameOff, nameOff + name.length),
    children: [],
  }];
}

const reset = () => {
  __state.config = {}; __state.messages = []; __state.warnResponses = [];
  __state.commands = {}; __state.executeCalls = []; __state.symbols = undefined;
  __state.activeTextEditor = undefined;
};

// ---- resolution: kind, walk-up, gating ----------------------------------

test("resolves a Struct to the container and tags kind=struct when types are admitted", async () => {
  reset();
  __state.symbols = structSymbols();
  const doc = makeDoc(STRUCT_SRC);
  const cursor = posAt(STRUCT_SRC, STRUCT_SRC.indexOf("pub addr") + 2); // inside a field
  const r = await resolveFunctionAtCursor(doc, cursor, true);
  assert.ok(r, "a struct at the cursor resolves");
  assert.strictEqual(r.kind, "struct");
  assert.strictEqual(r.symbolName, "ServerConfig");
  // Head normalization walked past the doc comment AND the #[derive(...)]: the
  // span starts at the declaration head, so the doc + attribute stay outside it.
  assert.strictEqual(r.signature, "pub struct ServerConfig", `header is the declaration head, got ${JSON.stringify(r.signature)}`);
  const spanStart = doc.getText(new Range(doc.positionAt(r.span.start), doc.positionAt(r.span.start + 3)));
  assert.strictEqual(spanStart, "pub", "span begins at the declaration head, not the doc comment");
  assert.ok(r.docComment && r.docComment.includes("Configuration for the server"), "doc comment carried, outside the span");
});

test("cursor on an EnumMember walks up to the Enum container (variants stay out of the kind set)", async () => {
  reset();
  __state.symbols = enumSymbols();
  const doc = makeDoc(ENUM_SRC);
  const cursor = posAt(ENUM_SRC, ENUM_SRC.indexOf("Request") + 2);
  const r = await resolveFunctionAtCursor(doc, cursor, true);
  assert.ok(r);
  assert.strictEqual(r.kind, "enum");
  assert.strictEqual(r.symbolName, "Message");
  assert.strictEqual(r.signature, "pub enum Message");
});

test("gate: with types NOT admitted a struct is not a target (v1 function-only resolution)", async () => {
  reset();
  __state.symbols = structSymbols();
  const doc = makeDoc(STRUCT_SRC);
  const cursor = posAt(STRUCT_SRC, STRUCT_SRC.indexOf("pub addr") + 2);
  const r = await resolveFunctionAtCursor(doc, cursor, false);
  assert.strictEqual(r, undefined, "admitTypes=false => a struct resolves to nothing, exactly v1");
});

test("a function still resolves with types admitted (kind=function), unchanged", async () => {
  reset();
  const t = STRUCT_SRC;
  const fnOff = t.indexOf("pub fn after");
  const fnClose = t.indexOf("}", fnOff) + 1;
  const nameOff = t.indexOf("after", fnOff);
  __state.symbols = [{
    name: "after", kind: SymbolKind.Function,
    range: rangeFor(t, fnOff, fnClose),
    selectionRange: rangeFor(t, nameOff, nameOff + 5),
    children: [],
  }];
  const doc = makeDoc(t);
  const r = await resolveFunctionAtCursor(doc, posAt(t, fnOff + 4), true);
  assert.ok(r);
  assert.strictEqual(r.kind, "function");
  assert.strictEqual(r.signature, "pub fn after(x: i64) -> i64");
});

// ---- boundary invariant over a struct AND an enum, via the REAL span -----

function boundaryProof(src, symbols, cursorNeedle, newBody) {
  __state.symbols = symbols;
  const doc = makeDoc(src);
  return resolveFunctionAtCursor(doc, posAt(src, src.indexOf(cursorNeedle) + 2), true).then((r) => {
    assert.ok(r, "resolves");
    const spliced = spliceSpan(src, r.span, newBody);
    // The replacement lands exactly in the span.
    assert.strictEqual(spliced, src.slice(0, r.span.start) + newBody + src.slice(r.span.end));
    // The boundary oracle AND an independent slice comparison must agree.
    assert.strictEqual(byteCompareOutsideSpan(src, spliced, r.span), true, "oracle: outside the span byte-identical");
    const suffixLen = src.length - r.span.end;
    assert.strictEqual(spliced.slice(0, r.span.start), src.slice(0, r.span.start), "independent: prefix unchanged");
    assert.strictEqual(spliced.slice(spliced.length - suffixLen), src.slice(r.span.end), "independent: suffix unchanged");
    // And under UTF-8 bytes, not just UTF-16 units.
    assert.ok(Buffer.from(spliced.slice(0, r.span.start)).equals(Buffer.from(src.slice(0, r.span.start))), "prefix bytes identical");
    assert.ok(Buffer.from(spliced.slice(spliced.length - suffixLen)).equals(Buffer.from(src.slice(r.span.end))), "suffix bytes identical");
    return r;
  });
}

test("boundary invariant: regenerating a STRUCT body never touches bytes outside its span", async () => {
  reset();
  const newBody = "pub struct ServerConfig {\n    pub addr: String,\n    pub port: u16,\n    pub tls: bool,\n}";
  const r = await boundaryProof(STRUCT_SRC, structSymbols(), "pub addr", newBody);
  // The neighbouring functions and the doc comment survived verbatim.
  const spliced = spliceSpan(STRUCT_SRC, r.span, newBody);
  assert.ok(spliced.includes("pub fn before(x: i64) -> i64 {"), "the function above is intact");
  assert.ok(spliced.includes("pub fn after(x: i64) -> i64 {"), "the function below is intact");
  assert.ok(spliced.includes("/// Configuration for the server."), "the doc comment (outside the span) is intact");
  assert.ok(spliced.includes("pub tls: bool"), "the new field landed inside the span");
});

test("boundary invariant: regenerating an ENUM body never touches bytes outside its span", async () => {
  reset();
  const newBody = "pub enum Message {\n    Request(String),\n    Response { code: u16 },\n    Heartbeat,\n    Close,\n}";
  const r = await boundaryProof(ENUM_SRC, enumSymbols(), "Request", newBody);
  const spliced = spliceSpan(ENUM_SRC, r.span, newBody);
  assert.ok(spliced.includes("pub fn tail() {}"), "the trailing function is intact");
  assert.ok(spliced.includes("/// A protocol message."), "the doc comment is intact");
  assert.ok(spliced.includes("Close,"), "the new variant landed inside the span");
});

// ---- brace-less unit/tuple structs: honest no-op -------------------------

function driveBraceless(src, name) {
  reset();
  __state.config = { compilerDirectedInjection: true, apiBase: "http://127.0.0.1:9", fnGenModel: "fake" };
  __state.symbols = unitSymbols(src, name);
  const doc = makeDoc(src);
  __state.activeTextEditor = { document: doc, selection: { active: posAt(src, src.indexOf(name)) } };
  const lines = [];
  registerFnGen({ subscriptions: [] }, { appendLine: (l) => lines.push(l) }, new ContextBlockStore(() => {}), {
    buildService: async () => ({
      service: { dispose() {}, generate: async () => { throw new Error("must not generate a brace-less struct"); }, generateRaw: async () => undefined, logOutcome() {}, get modelTag() { return "fake"; } },
      tier: { fnGenEnabled: true, message: "ok" },
      config: {},
    }),
  });
  return { lines };
}

test("brace-less unit struct (struct Marker;) no-ops with an honest message, never generates", async () => {
  const { lines } = driveBraceless(UNIT_SRC, "Marker");
  await __state.commands["column80.generateFunction"]();
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn, "the human gets a message");
  assert.match(warn.message, /nothing to generate/i);
  assert.match(warn.message, /unit or tuple struct/i);
  assert.ok(lines.some((l) => l.includes("nothing to generate")), "the no-op is on the evidence channel");
  assert.ok(!lines.some((l) => l.startsWith("[fngen] gen")), "no model call was made");
});

test("brace-less tuple struct (struct Id(pub u64);) no-ops the same way", async () => {
  const { lines } = driveBraceless(TUPLE_SRC, "Id");
  await __state.commands["column80.generateFunction"]();
  const warn = __state.messages.find((m) => m.kind === "warn");
  assert.ok(warn && /nothing to generate/i.test(warn.message), "tuple struct is also no-op'd");
  assert.ok(!lines.some((l) => l.startsWith("[fngen] gen")), "no model call");
});

// ---- service threads kind into the type prompt, extraction handles it ----

async function generateWith(kind, signature, docComment, reply) {
  let capturedPrompt;
  const svc = new FnGenService(
    { apiBase: "http://127.0.0.1:9", model: "fake", fallbackModel: "fake2", maxTokens: 256, temperature: 0.2 },
    async (p) => { capturedPrompt = p.prompt; return { text: reply, ttftMs: 1, totalMs: 2 }; },
    () => {},
  );
  const out = await svc.generate({ signature, docComment, languageId: "rust", kind });
  svc.dispose();
  return { out, capturedPrompt };
}

test("service routes kind=struct to the type instruction and returns the extracted struct body", async () => {
  const reply = "Here is the struct:\n```rust\npub struct Foo {\n    a: i32,\n    b: String,\n}\n```\nThat should do it.";
  const { out, capturedPrompt } = await generateWith("struct", "pub struct Foo", "/// A pair.", reply);
  assert.ok(capturedPrompt.includes("struct definition"), "prompt is type-shaped");
  assert.ok(!capturedPrompt.includes("Implement the function"), "prompt is not the function instruction");
  assert.ok(out, "a result resolves");
  assert.strictEqual(out.text, "pub struct Foo {\n    a: i32,\n    b: String,\n}", "the fenced struct is extracted whole");
});

test("service kind=enum: extraction keeps the whole enum and trims a trailing top-level item", async () => {
  const reply = "```rust\npub enum Color {\n    Red,\n    Rgb { r: u8, g: u8, b: u8 },\n    Named(String),\n}\n\nimpl Color {}\n```";
  const { out, capturedPrompt } = await generateWith("enum", "pub enum Color", "/// A colour.", reply);
  assert.ok(capturedPrompt.includes("enum definition"), "prompt is enum-shaped");
  assert.ok(out.text.startsWith("pub enum Color {"), "starts at the enum header");
  assert.ok(out.text.trimEnd().endsWith("}"), "ends at the enum closing brace");
  assert.ok(!out.text.includes("impl Color"), "the trailing impl block was trimmed off");
  // A multi-line inline struct variant does NOT end the type early: the inner
  // `}` is indented, only the column-0 brace closes the enum.
  assert.ok(out.text.includes("Named(String),"), "the variant after the struct-variant survives");
});

// ---- extraction / postprocess directly on type bodies -------------------

test("extractRequestedFunction anchors a struct header and stops at the column-0 closing brace", () => {
  const text = "use std::collections::HashMap;\npub struct Cache {\n    map: HashMap<String, u32>,\n}\nfn helper() {}";
  const ex = extractRequestedFunction(text, "pub struct Cache");
  assert.ok(ex, "the struct is found");
  assert.strictEqual(ex.text, "pub struct Cache {\n    map: HashMap<String, u32>,\n}");
  assert.ok(ex.trimmedBefore >= 1, "the leading use line was cut");
  assert.ok(ex.trimmedAfter >= 1, "the trailing helper fn was cut");
});

test("extractRequestedFunction: an enum with a multi-line struct variant is not cut at the inner brace", () => {
  const text = "pub enum E {\n    A,\n    B {\n        x: u8,\n    },\n    C,\n}";
  const ex = extractRequestedFunction(text, "pub enum E");
  assert.ok(ex);
  assert.strictEqual(ex.text, text, "the whole enum survives; the indented inner `}` does not end it");
  assert.strictEqual(ex.trimmedAfter, 0);
});

test("postprocessInstructOutput extracts a struct from a fenced reply with prose around it", () => {
  const raw = "Sure!\n```rust\npub struct P {\n    x: i32,\n}\n```\nLet me know if you want more.";
  assert.strictEqual(postprocessInstructOutput(raw), "pub struct P {\n    x: i32,\n}");
});

// ---- F3: a sibling type whose name extends the target must not steal the
// anchor (a type header has no `(` boundary, unlike a function). --------------

test("F3: extraction anchors `pub struct Cache` on Cache, not the sibling CacheEntry above it", () => {
  const text = "pub struct CacheEntry {\n    key: String,\n}\npub struct Cache {\n    entries: Vec<CacheEntry>,\n}";
  const ex = extractRequestedFunction(text, "pub struct Cache");
  assert.ok(ex, "the target struct is found");
  assert.strictEqual(ex.text, "pub struct Cache {\n    entries: Vec<CacheEntry>,\n}", "the Cache block is returned, not CacheEntry");
  assert.ok(!ex.text.startsWith("pub struct CacheEntry"), "the longer-named sibling did not steal the anchor");
  assert.ok(ex.trimmedBefore >= 1, "the CacheEntry sibling above was cut as leading noise");
});

test("F3: a boundary other than `{` also anchors the whole name (generic `<`, `;`, `where`)", () => {
  const generic = "pub struct WrapperInner<T> {\n    t: T,\n}\npub struct Wrapper<T> {\n    inner: T,\n}";
  const ex = extractRequestedFunction(generic, "pub struct Wrapper");
  assert.ok(ex && ex.text.startsWith("pub struct Wrapper<T>"), "the `<` boundary keeps Wrapper distinct from WrapperInner");
});

test("F3: the function path is unchanged — a function head still anchors on its `(`", () => {
  const text = "fn helper() {}\nfn help() {\n    do_it();\n}";
  const ex = extractRequestedFunction(text, "fn help()");
  assert.ok(ex);
  assert.strictEqual(ex.text, "fn help() {\n    do_it();\n}", "the `(` boundary already protected functions; behaviour unchanged");
});

// ---- F1: the E0425/E0412 worked-example steering fires for a landed
// struct/enum. The bug: the post-accept resolver was called 2-arg (types not
// admitted), so a landed struct resolved to undefined and the repair loop
// aborted BEFORE resolveSurfaceInjection ran. Two halves proven headless:
// (a) with types admitted the resolver returns a truthy struct/enum, so the
// `if (!resolved) abort` branch is not taken; (b) resolveSurfaceInjection (real
// classifier + stub extractor) injects the worked example for an E0425/E0412
// field hallucination; and (c) the repair prompt is TYPE-shaped for the target.

const e0Diag = (code, message) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: 12, lineEnd: 12, columnStart: 17, columnEnd: 40, isPrimary: true }],
  suggestions: [],
});

test("F1(a): the repair-path resolver admits a landed struct when injection is on (no abort), and stays v1 when off", async () => {
  reset();
  __state.symbols = structSymbols();
  const doc = makeDoc(STRUCT_SRC);
  const cursor = posAt(STRUCT_SRC, STRUCT_SRC.indexOf("pub addr") + 2);
  // The exact closure the two fnGen.ts call sites now install.
  const resolverOn = (d, p) => resolveFunctionAtCursor(d, p, true);
  const resolverOff = (d, p) => resolveFunctionAtCursor(d, p, false);
  const on = await resolverOn(doc, cursor);
  assert.ok(on, "injection on: a landed struct resolves — the `if (!resolved) abort` branch is NOT taken");
  assert.strictEqual(on.kind, "struct", "the kind is carried into the repair prompt");
  const off = await resolverOff(doc, cursor);
  assert.strictEqual(off, undefined, "injection off: v1 function-only, struct never a repair target");
});

test("F1(b): resolveSurfaceInjection injects the worked example for an E0425 field hallucination (real classifier)", async () => {
  const calls = [];
  const extractor = {
    example: async (cursor, prefer) => { calls.push({ cursor, prefer }); return "let x = some_crate::RealType::new();"; },
    completeMembers: async () => { throw new Error("example exists; signatures must not be reached"); },
  };
  const doc = makeDoc("pub struct Holder {\n    field: some_crate::InventedType,\n}", "file:///w/main.rs");
  doc.uri = { toString: () => "file:///w/main.rs" };
  const out = await resolveSurfaceInjection(
    extractor, doc,
    [e0Diag("E0425", "cannot find value `InventedType` in crate `some_crate`")],
    () => {},
  );
  assert.ok(out, "a surface payload is produced — the loop injects, it does not abort");
  assert.ok(out.includes("some_crate::RealType::new()"), "the worked example is the payload");
  assert.strictEqual(calls.length, 1, "the extractor was consulted once");
  assert.strictEqual(calls[0].prefer, "InventedType", "the compiler-named invented item biases example selection");
});

test("F1(b'): the same steering fires for the E0412 type-hallucination code", async () => {
  const extractor = {
    example: async () => undefined,
    completeMembers: async () => [{ name: "with_capacity", signature: "with_capacity(n: usize) -> Real", kind: "method" }],
  };
  const doc = makeDoc("x", "file:///w/main.rs");
  doc.uri = { toString: () => "file:///w/main.rs" };
  const out = await resolveSurfaceInjection(
    extractor, doc,
    [e0Diag("E0412", "cannot find type `InventedType` in module `some_crate::sub`")],
    () => {},
  );
  assert.ok(out && out.includes("with_capacity(n: usize) -> Real"), "falls back to signatures when no example resolves, still injecting rather than aborting");
});

test("F1(c): the repair prompt is TYPE-shaped for a struct/enum target, byte-identical to v1 for a function", () => {
  const base = {
    languageId: "rust",
    docComment: "/// A cache.",
    code: "pub struct Cache {\n    bad: some_crate::InventedType,\n}",
    diagnostics: [e0Diag("E0425", "cannot find value `InventedType` in crate `some_crate`")],
  };
  const asStruct = assembleRepairPrompt({ ...base, kind: "struct" });
  assert.ok(asStruct.includes("struct definition below failed the compiler check"), "type-shaped intro");
  assert.ok(asStruct.includes("Fix the struct."), "type-shaped instruction");
  assert.ok(asStruct.includes("staying strictly inside this one type"), "holds the reply inside the type");
  assert.ok(!asStruct.includes("The function below failed"), "not the function intro");

  const asEnum = assembleRepairPrompt({ ...base, code: "pub enum E {\n    Bad(some_crate::InventedType),\n}", kind: "enum" });
  assert.ok(asEnum.includes("enum definition below failed") && asEnum.includes("Fix the enum."), "enum-shaped");

  // Function identity: omitted and "function" reproduce the exact same bytes,
  // and they are the v1 function wording (frozen blind7 pins the full bytes).
  const asFn = assembleRepairPrompt({ ...base });
  assert.strictEqual(assembleRepairPrompt({ ...base, kind: "function" }), asFn, "function == omitted");
  assert.ok(asFn.includes("The function below failed the compiler check") && asFn.includes("Fix the function."), "v1 function wording");
  assert.notStrictEqual(asStruct, asFn, "kind changes the repair bytes");
});
