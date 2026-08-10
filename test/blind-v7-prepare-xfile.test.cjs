// Blind oracle for v7 Phase 2: unify `resolvePrefill` (src/vscode/fnGen.ts) onto
// the cross-file resolver. Written WITHOUT reading the resolvePrefill /
// localTypeBlock / buildLocalStructMap bodies - only the exported
// resolvePrefill(extractor, document, resolved, log) signature + ResolvedFunction,
// the settled resolver surface (src/core/crossFileShape.ts) and the extraction
// interface (src/core/extraction.ts).
//
// CONTRACT under test:
//   When a function signature names a type T (`Order`) whose definition lives in
//   ANOTHER file, and T has a field of a struct type U (`Customer`) ALSO defined
//   out-of-file, the pre-fill surface must inject U's real shape (its field
//   `display_name`) AND T's methods (`net_minor_units`) - not just T's own
//   same-file fields. Today the struct/field graph is SAME-FILE ONLY, so the
//   cross-file nested field is a SILENT MISS. This test asserts the cross-file
//   shape IS present, so it is RED now and GREEN once prepare is wired onto
//   resolveCrossFileShape (which crosses files via extractor.definition()).
//
// Headless: esbuild-bundles resolvePrefill against a vscode stub (alias {vscode:
// STUB}); fakes SurfaceExtractor and vscode.TextDocument. The stub's
// workspace.openTextDocument serves a uri->text map (via globalThis) so the
// resolver's openFile can read domain.rs to anchor the recursive walk.
//
// Run: SKIP_LIVE=1 node --test test/blind-v7-prepare-xfile.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// --- vscode stub. SymbolKind carries the kinds fnGen builds Sets from at module
// load; workspace.openTextDocument(uri) serves a uri->text map wired through
// globalThis.__V7_FILES__ (the bundle and this test share one process global, so
// the test can populate the map the bundled resolver reads). ------------------
const STUB = path.join(__dirname, ".blind-v7-xfile-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
class Selection extends Range {}
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: {
    openTextDocument: (arg) => {
      const files = globalThis.__V7_FILES__ || {};
      const key = keyOf(arg);
      const text = files[key];
      return Promise.resolve({ uri: mkUri(key), getText: () => text });
    },
  },
};\n`
);

const entry = path.join(__dirname, ".blind-v7-xfile.entry.ts");
const outfile = path.join(__dirname, ".blind-v7-xfile.bundle.cjs");
fs.writeFileSync(entry, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolvePrefill } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// --- Fake vscode.TextDocument over a source string (same mechanics as the v6
// seam): getText() returns the full buffer or a sliced range; positionAt/offsetAt
// do the UTF-16 offset math; uri.toString() is stable. ------------------------
function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
    return o + pos.character;
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

// The identifier word covering a cursor, mirroring crossFileShape.identifierAt -
// the fakes key their answers off "which type token is the cursor on".
function wordAt(text, cursor) {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  const w = line.slice(s, e);
  return w.length > 0 ? w : undefined;
}

// --- The CROSS-FILE scenario. consumer.rs names `Order` in the signature and
// imports it, but neither Order nor Customer is DEFINED here. domain.rs holds
// both struct defs (with the cross-file field `placed_by: Customer`) and their
// inherent methods. ----------------------------------------------------------
const CONSUMER_URI = "file:///w/src/consumer.rs";
const DOMAIN_URI = "file:///w/src/domain.rs";

const CONSUMER_SRC = `use crate::domain::Order;

/// Read the order total.
fn read_order(o: &Order) -> u64 {

}
`;

const DOMAIN_SRC = `pub struct Order {
    pub reference: String,
    pub placed_by: Customer,
}

impl Order {
    pub fn net_minor_units(&self) -> u64 { 0 }
}

pub struct Customer {
    pub display_name: String,
}

impl Customer {
    pub fn is_patron(&self) -> bool { false }
}
`;

// The struct hover signatures the resolver reads for fields (verbatim RA form).
const ORDER_HOVER = "pub struct Order { pub reference: String, pub placed_by: Customer }";
const CUSTOMER_HOVER = "pub struct Customer { pub display_name: String }";

// Members (with rendered fn signatures; renderMemberSignatures reads .signature).
const ORDER_METHODS = [{ name: "net_minor_units", signature: "net_minor_units(&self) -> u64", kind: "method" }];
const CUSTOMER_METHODS = [{ name: "is_patron", signature: "is_patron(&self) -> bool", kind: "method" }];

const KNOWN = new Set(["Order", "Customer"]);
// Which out-of-file type a cursor sits on: the exact word when it is a known
// type, else the first known type on the cursor's LINE. The line fallback keeps
// the ROOT anchor (implementer code we cannot see) from being column-brittle,
// while the recursion cursor (resolver-computed, exact) resolves precisely.
function typeAtCursor(uri, cursor) {
  const text = uri === CONSUMER_URI ? CONSUMER_SRC : uri === DOMAIN_URI ? DOMAIN_SRC : undefined;
  if (!text) return undefined;
  const w = wordAt(text, cursor);
  if (w && KNOWN.has(w)) return w;
  const line = text.split("\n")[cursor.line] ?? "";
  for (const t of KNOWN) {
    if (new RegExp(`\\b${t}\\b`).test(line)) return t;
  }
  return undefined;
}

// A DefinitionLocation pointing at the struct NAME token of `typeName` in domain.rs.
function defLocFor(typeName) {
  const lines = DOMAIN_SRC.split("\n");
  const ln = lines.findIndex((l) => new RegExp(`\\bstruct ${typeName}\\b`).test(l));
  const ch = lines[ln].indexOf(typeName);
  return { uri: DOMAIN_URI, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + typeName.length } };
}

// A recording, position-aware fake SurfaceExtractor. definition() crosses files
// (consumer Order token -> domain.rs Order def; domain Customer token -> domain.rs
// Customer def). hoverSurface / membersOfType answer by the type at the DEF
// cursor. All other extractor methods degrade to empty/undefined.
function extractor() {
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [], completeMembers: [], qualifyImport: [] };
  const ext = {
    definition: async (cursor) => {
      calls.definition.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (cursor) => {
      calls.hoverSurface.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      if (t === "Order") return { signature: ORDER_HOVER };
      if (t === "Customer") return { signature: CUSTOMER_HOVER };
      return undefined;
    },
    membersOfType: async (cursor) => {
      calls.membersOfType.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      if (t === "Order") return ORDER_METHODS;
      if (t === "Customer") return CUSTOMER_METHODS;
      return [];
    },
    example: async (...a) => { calls.example.push(a); return undefined; },
    completeMembers: async (...a) => { calls.completeMembers.push(a); return []; },
    qualifyImport: async (...a) => { calls.qualifyImport.push(a); return undefined; },
  };
  return { ext, calls };
}

// ResolvedFunction for read_order (span = its body, UTF-16 offsets).
function resolvedForConsumer() {
  const start = CONSUMER_SRC.indexOf("fn read_order");
  const end = CONSUMER_SRC.indexOf("}", start) + 1;
  return {
    span: { start, end },
    signature: "fn read_order(o: &Order) -> u64",
    docComment: "Read the order total.",
    symbolName: "read_order",
    languageId: "rust",
    kind: "function",
  };
}

function withFiles(fn) {
  globalThis.__V7_FILES__ = { [CONSUMER_URI]: CONSUMER_SRC, [DOMAIN_URI]: DOMAIN_SRC };
  return Promise.resolve()
    .then(fn)
    .finally(() => { delete globalThis.__V7_FILES__; });
}

// ===========================================================================
// THE CONTRACT: cross-file nested shape (Customer.display_name) + Order's method
// (net_minor_units) are injected when Order is named in the signature but defined
// in domain.rs. Today (same-file-only graph) both are silently absent -> RED.
// ===========================================================================
test("prepare resolves cross-file: Order's method + nested Customer.display_name are injected", async () => {
  await withFiles(async () => {
    const { ext, calls } = extractor();
    const doc = makeDoc(CONSUMER_SRC, CONSUMER_URI);
    const out = (await resolvePrefill(ext, doc, resolvedForConsumer(), () => {})) || "";

    // --- Load-bearing cross-file assertions (impossible on same-file-only code):

    // (1) The nested, out-of-file type Customer's REAL field. Reaching it means
    // the walk crossed consumer.rs -> domain.rs (Order), then re-anchored into
    // Order's body and crossed AGAIN to Customer's def. This is the silent miss.
    assert.ok(
      out.includes("display_name"),
      `nested cross-file field Customer.display_name must be injected (the cross-file walk). ` +
        `Absent today. definition() calls=${calls.definition.length}. OUT:\n${out}`,
    );

    // (2) Order's own method, resolved via membersOfType at its out-of-file def.
    assert.ok(
      out.includes("net_minor_units("),
      `Order's method net_minor_units must appear in the API-surface block ` +
        `(membersOfType at the cross-file def). Absent today. OUT:\n${out}`,
    );

    // (3) Order's cross-file field + the nested type NAME, proving Order's shape
    // (not just its methods) crossed the file boundary.
    assert.ok(out.includes("placed_by"), `Order.placed_by (cross-file field) must be injected. OUT:\n${out}`);
    assert.ok(/\bCustomer\b/.test(out), `the nested field type Customer must be named. OUT:\n${out}`);

    // (4) SOFTER: nested method is a nice-to-have (are nested methods injected?).
    // Not a hard bar - clear signal to the implementer either way.
    if (!out.includes("is_patron(")) {
      console.log(
        "[soft] Customer.is_patron (nested cross-file method) is NOT injected - " +
          "nested-type methods did not make the surface (root method net_minor_units is the firm bar).",
      );
    }

    // --- Nothing invented: only names present in the fakes may appear. A field
    // or type the resolver never resolved must never surface.
    assert.ok(!/shipping_address/.test(out), `no invented field (shipping_address) may appear. OUT:\n${out}`);
    assert.ok(!/\bInvoice\b/.test(out), `no invented type (Invoice) may appear. OUT:\n${out}`);
    assert.ok(!/\bLineItem\b/.test(out), `no invented type (LineItem) may appear. OUT:\n${out}`);

    // --- Black-box liveness: crossing files REQUIRES definition(). Today it has
    // zero call sites for prepare, so this is part of the red signal.
    assert.ok(
      calls.definition.length >= 1,
      `prepare must call definition() to cross the file boundary; got ${calls.definition.length} calls`,
    );
  });
});
