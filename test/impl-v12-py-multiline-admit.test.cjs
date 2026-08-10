// Implementer oracle (v12 Phase 2): the RESOLVER-level composition that a
// multi-line Python base list classifies correctly. The pure classifier
// (pyTypeGenKind) already handles a wrapped base list (blind + impl edge
// suites), but resolveFunctionAtCursor must FEED it the whole base list. An
// earlier build sliced the header only from range.start.line through
// selectionRange.start.line (the class-NAME line), which drops an enum base on a
// continuation line BELOW the name — misclassifying `class Big(\n Mixin,\n Enum,\n):`
// as "class". The fix classifies off the SIGNATURE (which runs through the base
// list to the header `:`). This drives the REAL resolveFunctionAtCursor over a
// fake vscode to pin the composition, not just the pure function.
//
// Run: SKIP_LIVE=1 node --test test/impl-v12-py-multiline-admit.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v12-pyml-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character){ this.line=line; this.character=character; }
  isBefore(o){return this.line<o.line||(this.line===o.line&&this.character<o.character);}
  isBeforeOrEqual(o){return this.isBefore(o)||this.isEqual(o);} isAfter(o){return !this.isBeforeOrEqual(o);}
  isAfterOrEqual(o){return !this.isBefore(o);} isEqual(o){return this.line===o.line&&this.character===o.character;} }
class Range { constructor(a,b,c,d){ if(typeof a==="number"){this.start=new Position(a,b);this.end=new Position(c,d);} else {this.start=a;this.end=b;} }
  contains(p){ const ps=p.start?p.start:p, pe=p.end?p.end:p;
    const geS=ps.line>this.start.line||(ps.line===this.start.line&&ps.character>=this.start.character);
    const leE=pe.line<this.end.line||(pe.line===this.end.line&&pe.character<=this.end.character); return geS&&leE; } }
const mkUri=(full,fsPath)=>({scheme:"file",fsPath,path:fsPath,query:"",fragment:"",toString:()=>full,with(){return this;},toJSON(){return full;}});
const Uri={ file:(p)=>mkUri("file://"+p,p), parse:(s)=>mkUri(String(s),String(s).replace(/^file:\\/\\//,"")) };
const disposable=()=>({dispose(){}});
module.exports={ Position, Range, Uri,
  SymbolKind:{ File:0,Module:1,Namespace:2,Package:3,Class:4,Method:5,Property:6,Field:7,Constructor:8,Enum:9,Interface:10,Function:11,Variable:12,Constant:13,String:14,Number:15,Boolean:16,Array:17,Object:18,Key:19,Null:20,EnumMember:21,Struct:22 },
  workspace:{ getConfiguration:()=>({get:(k,f)=>f,has:()=>false}), onDidChangeConfiguration:()=>disposable(), get textDocuments(){return globalThis.__PYML_DOCS__||[];} },
  window:{ createOutputChannel:()=>({appendLine(){},append(){},show(){},dispose(){}}), showWarningMessage:async()=>undefined },
  commands:{ registerCommand:()=>disposable(), executeCommand:async(id,uri)=>{ if(id==="vscode.executeDocumentSymbolProvider"){ const k=uri&&uri.toString?uri.toString():String(uri); return (globalThis.__PYML_SYMBOLS__||{})[k]; } return undefined; } },
  languages:{ createDiagnosticCollection:()=>({set(){},delete(){},clear(){},dispose(){}}), getDiagnostics:()=>[], onDidChangeDiagnostics:()=>disposable() },
};
`,
);

const entry = path.join(__dirname, ".impl-v12-pyml.entry.ts");
const out = path.join(__dirname, ".impl-v12-pyml.bundle.cjs");
let V = {};
let bundleErr;
try {
  fs.writeFileSync(entry, `export { resolveFunctionAtCursor } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: out, format: "cjs", platform: "node", alias: { vscode: STUB } });
  V = require(out);
} catch (e) {
  bundleErr = e;
}
test.after(() => {
  for (const f of [STUB, entry, out]) fs.rmSync(f, { force: true });
});

const { Position, Range } = require(STUB);
const P = (l, c) => new Position(l, c);
const R = (sl, sc, el, ec) => new Range(sl, sc, el, ec);

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => { let o = 0; for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1; return Math.min(o + pos.character, text.length); };
  const positionAt = (off) => { let o = 0; for (let l = 0; l < lines.length; l++) { if (off <= o + lines[l].length) return P(l, off - o); o += lines[l].length + 1; } return P(lines.length - 1, lines[lines.length - 1].length); };
  return {
    uri: require(STUB).Uri.parse(uriStr), fileName: uriStr, languageId: "python", version: 1, lineCount: lines.length, offsetAt, positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => { const n = typeof arg === "number" ? arg : arg.line; const t = lines[n] ?? ""; const m = t.match(/\S/); return { lineNumber: n, text: t, range: R(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m }; },
  };
}
const sym = (name, kind, range, sel, children = []) => ({ name, detail: "", kind, range, selectionRange: sel, children });
const K = { Class: 4 };

test("bundle guard", () => { if (bundleErr) assert.fail(`bundle failed: ${bundleErr.message}`); });

// A class whose base list wraps across lines, with the enum base on a
// continuation line BELOW the class-name (selectionRange) line.
//  0 class BigEnum(
//  1     SomeMixin,
//  2     Enum,
//  3 ):
//  4     A = 1
const ML_ENUM_URI = "file:///proj/ml_enum.py";
const ML_ENUM_TEXT = "class BigEnum(\n    SomeMixin,\n    Enum,\n):\n    A = 1\n";
const mlEnum = sym("BigEnum", K.Class, R(0, 0, 4, 9), R(0, 6, 0, 12)); // selectionRange on line 0 (name)

//  0 class BigPlain(
//  1     SomeMixin,
//  2     Base,
//  3 ):
//  4     x: int = 0
const ML_PLAIN_URI = "file:///proj/ml_plain.py";
const ML_PLAIN_TEXT = "class BigPlain(\n    SomeMixin,\n    Base,\n):\n    x: int = 0\n";
const mlPlain = sym("BigPlain", K.Class, R(0, 0, 4, 14), R(0, 6, 0, 14));

const resolveWith = (uri, text, symbol, line, ch) => {
  const doc = makeDoc(text, uri);
  globalThis.__PYML_SYMBOLS__ = { [uri]: [symbol] };
  globalThis.__PYML_DOCS__ = [doc];
  return V.resolveFunctionAtCursor(doc, P(line, ch), true);
};

test('multi-line base list with the enum base on a continuation line -> genKind "enum"', async () => {
  if (bundleErr) return;
  const r = await resolveWith(ML_ENUM_URI, ML_ENUM_TEXT, mlEnum, 0, 8);
  assert.ok(r, "the class resolves");
  assert.strictEqual(r.kind, "enum", `a wrapped base list carrying Enum must classify enum through the resolver, got ${JSON.stringify(r && r.kind)}`);
});

test('multi-line base list with no enum base -> genKind "class"', async () => {
  if (bundleErr) return;
  const r = await resolveWith(ML_PLAIN_URI, ML_PLAIN_TEXT, mlPlain, 0, 8);
  assert.ok(r, "the class resolves");
  assert.strictEqual(r.kind, "class", `a wrapped non-enum base list must stay class, got ${JSON.stringify(r && r.kind)}`);
});
