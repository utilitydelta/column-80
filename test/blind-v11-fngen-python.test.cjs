// BLIND ORACLE — v11 (Python) Phase 4, the fn-gen HEAD-PATH pure builds:
//   1. pySignatureFromSpanText(spanText)  (src/vscode/fnGen.ts, exported sibling
//      of the already-exported csSignatureFromSpanText). Depth-aware header
//      slicer: stops at the `:` that terminates the def header at bracket-depth
//      0. The Rust default (signatureFromSpanText) cuts at the first `{` then
//      the first newline, which is WRONG for a multi-line Python header.
//   2. declarationHeadLine(getLine, startLine, nameLine, lineComments?)
//      (src/core/symbols.ts). The F1 fix: an optional `lineComments` param
//      (default []), byte-identical for every existing Rust/TS/C# caller, that
//      teaches the trivia walk a language's line-comment token.
//
// Written from phase4-brief.md section (c) NEW BUILD 2 + WP6/WP9 ONLY. The
// implementations are written AFTER this file and are never opened.
//
// These are HARD assertions (NOT todo): the F1 resolution is fully specified,
// and pySignatureFromSpanText's depth-0-terminator contract is concrete.
//
// NOTE for the implementer: the F1 tripwire in blind-v11-seam.test.cjs is a
// SEPARATE `{ todo: true }` guard on the 3-arg call shape; updating THAT call
// signature to the new 4-arg form is the seam-author's job when F1 lands. This
// file does not touch it.
//
// Run: SKIP_LIVE=1 node --test test/blind-v11-fngen-python.test.cjs
// Expected: pySignatureFromSpanText cases RED until it lands; the F1
// declarationHeadLine cases RED until the lineComments param lands; the
// legacy-default declarationHeadLine cases GREEN today (proving the fix is
// opt-in and does not disturb existing callers).

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// Bundle A (pure core): declarationHeadLine — no vscode.
// ---------------------------------------------------------------------------
let core = {};
let coreCleanup = () => {};
let coreErr;
try {
  ({ mod: core, cleanup: coreCleanup } = bundleCore(
    "blind-v11-fngen-symbols",
    `export { declarationHeadLine } from "../src/core/symbols";\n`,
  ));
} catch (e) {
  coreErr = e;
}
const { declarationHeadLine } = core;

// ---------------------------------------------------------------------------
// Bundle B (vscode-importing): pySignatureFromSpanText lives in fnGen.ts, which
// imports vscode. Bundle it headless against a STRUCTURAL vscode stub (real
// Position/Range so module init runs; the slicer itself is pure string work).
// Same mechanism the blind-v10-gestures suite uses for fnGen.
// ---------------------------------------------------------------------------
const STUB = path.join(__dirname, ".blind-v11-fngen-stub.cjs");
const vEntry = path.join(__dirname, ".blind-v11-fngen-v.entry.ts");
const vOut = path.join(__dirname, ".blind-v11-fngen-v.bundle.cjs");
let fg = {};
let fgErr;
try {
  fs.writeFileSync(
    STUB,
    `
class Position { constructor(line, character){ this.line=line; this.character=character; }
  isBefore(o){return this.line<o.line||(this.line===o.line&&this.character<o.character);}
  isBeforeOrEqual(o){return this.isBefore(o)||this.isEqual(o);} isAfter(o){return !this.isBeforeOrEqual(o);}
  isAfterOrEqual(o){return !this.isBefore(o);} isEqual(o){return this.line===o.line&&this.character===o.character;}
  compareTo(o){return this.isEqual(o)?0:this.isBefore(o)?-1:1;} translate(l=0,c=0){return new Position(this.line+l,this.character+c);}
  with(line,character){return new Position(line===undefined?this.line:line,character===undefined?this.character:character);} }
class Range { constructor(a,b,c,d){ if(typeof a==="number"){this.start=new Position(a,b);this.end=new Position(c,d);} else {this.start=a;this.end=b;} }
  get isEmpty(){return this.start.line===this.end.line&&this.start.character===this.end.character;} get isSingleLine(){return this.start.line===this.end.line;}
  contains(p){const ps=p.start?p.start:p,pe=p.end?p.end:p; const geS=ps.line>this.start.line||(ps.line===this.start.line&&ps.character>=this.start.character); const leE=pe.line<this.end.line||(pe.line===this.end.line&&pe.character<=this.end.character); return geS&&leE;}
  with(start,end){return new Range(start||this.start,end||this.end);} }
const mkUri=(full,fsPath)=>({scheme:"file",fsPath,path:fsPath,query:"",fragment:"",toString:()=>full,with(){return this;},toJSON(){return full;}});
const Uri={file:(p)=>mkUri("file://"+p,p),parse:(s)=>mkUri(String(s),String(s)),joinPath:(b,...s)=>Uri.file([b.fsPath,...s].join("/"))};
const disposable=()=>({dispose(){}});
class MarkdownString{constructor(v){this.value=v||"";}appendCodeblock(t,l){this.value+=t;}appendMarkdown(t){this.value+=t;}appendText(t){this.value+=t;}}
class ThemeColor{constructor(id){this.id=id;}}
class Diagnostic{constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;}}
class EventEmitter{constructor(){this.h=[];}get event(){return (fn)=>{this.h.push(fn);return disposable();};}fire(x){for(const f of this.h)f(x);}dispose(){}}
module.exports={ Position,Range,Uri,MarkdownString,ThemeColor,Diagnostic,EventEmitter,
  DiagnosticSeverity:{Error:0,Warning:1,Information:2,Hint:3},
  SymbolKind:{File:0,Module:1,Namespace:2,Package:3,Class:4,Method:5,Property:6,Field:7,Constructor:8,Enum:9,Interface:10,Function:11,Variable:12,Constant:13,String:14,Number:15,Boolean:16,Array:17,Object:18,Key:19,Null:20,EnumMember:21,Struct:22,Event:23,Operator:24,TypeParameter:25},
  CompletionItemKind:{Method:1,Function:2,Field:4,Variable:5,Class:6,Property:9,Enum:12,Constant:20,Struct:21},
  OverviewRulerLane:{Left:1,Center:2,Right:4,Full:7},
  workspace:{getConfiguration:()=>({get:(k,f)=>f,has:()=>false,inspect:()=>undefined,update:async()=>{}}),onDidChangeConfiguration:()=>disposable(),onDidChangeTextDocument:()=>disposable(),onDidCloseTextDocument:()=>disposable(),get textDocuments(){return [];},openTextDocument:async()=>({})},
  languages:{createDiagnosticCollection:(name)=>({name,set(){},delete(){},clear(){},dispose(){}}),getDiagnostics:()=>[],onDidChangeDiagnostics:()=>disposable()},
  window:{createOutputChannel:(name)=>({name,appendLine(){},append(){},replace(){},show(){},hide(){},clear(){},dispose(){}}),createTextEditorDecorationType:(o)=>({o,dispose(){}}),showInformationMessage:async()=>undefined,showWarningMessage:async()=>undefined,showErrorMessage:async()=>undefined,activeColorTheme:{kind:1}},
  commands:{registerCommand:()=>disposable(),executeCommand:async()=>undefined},
};
`,
  );
  fs.writeFileSync(
    vEntry,
    `export { pySignatureFromSpanText, csSignatureFromSpanText } from "../src/vscode/fnGen";\n`,
  );
  esbuild.buildSync({ entryPoints: [vEntry], bundle: true, outfile: vOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
  fg = require(vOut);
} catch (e) {
  fgErr = e;
}
const { pySignatureFromSpanText, csSignatureFromSpanText } = fg;

test.after(() => {
  coreCleanup();
  for (const f of [STUB, vEntry, vOut]) fs.rmSync(f, { force: true });
});

test("bundle guard: symbols (declarationHeadLine) builds headless", () => {
  if (coreErr) assert.fail(`core bundle failed: ${coreErr.message}`);
});
test("bundle guard: fnGen (pySignatureFromSpanText) builds headless vs a vscode stub", () => {
  if (fgErr) assert.fail(`fnGen bundle failed: ${fgErr.message}`);
});

// ===========================================================================
// 1. pySignatureFromSpanText — depth-aware header slice, terminates at the
//    header-closing `:` at bracket-depth 0.
// ===========================================================================

test("pySignatureFromSpanText: single-line header -> whole header incl trailing ':'", () => {
  const spanText = "def f(a: int) -> int:\n    return a\n";
  assert.strictEqual(
    pySignatureFromSpanText(spanText),
    "def f(a: int) -> int:",
    "the single-line def header is returned whole, including the terminating ':' (the param 'a: int' colon at paren-depth 1 does NOT terminate)",
  );
});

test("pySignatureFromSpanText: MULTI-LINE header -> full header (where the Rust default returns only 'def f(')", () => {
  const spanText = "def f(\n    a: Widget,\n) -> Order:\n    return a\n";
  const got = pySignatureFromSpanText(spanText);
  // The concrete defect the brief names: the Rust default cuts at the first
  // newline and yields only "def f(". The Python slicer must reach the depth-0
  // ':' on the last physical line.
  assert.notStrictEqual(got, "def f(", "must NOT stop at the first newline like the Rust default");
  assert.match(got, /a:\s*Widget/, `the full param list survives the line breaks; got ${JSON.stringify(got)}`);
  assert.match(got, /->\s*Order\s*:/, `the header reaches the depth-0 '-> Order:' terminator; got ${JSON.stringify(got)}`);
  assert.match(got, /:\s*$/, `ends at the terminating ':' (no body captured); got ${JSON.stringify(got)}`);
});

test("pySignatureFromSpanText: a bracketed return 'Dict[str, int]' has no depth-0 ':' before the header ':'", () => {
  // The '[str, int]' subscript carries no colon; the ONLY depth-0 ':' is the
  // header terminator after the closing ']'. The whole return type is captured.
  const spanText = "def g(m: dict) -> Dict[str, int]:\n    return {}\n";
  const got = pySignatureFromSpanText(spanText);
  assert.match(got, /->\s*Dict\[str, ?int\]\s*:/, `the full 'Dict[str, int]' return survives; got ${JSON.stringify(got)}`);
  assert.match(got, /:\s*$/, `ends at the header terminator, not inside the subscript; got ${JSON.stringify(got)}`);
});

test("pySignatureFromSpanText: async def single-line header is returned whole", () => {
  const spanText = "async def fetch(u: Url) -> Order:\n    ...\n";
  assert.strictEqual(
    pySignatureFromSpanText(spanText),
    "async def fetch(u: Url) -> Order:",
    "async def header returned whole through the depth-0 ':'",
  );
});

// Frozen guard: the EXISTING C# slicer is byte-identical under the same bundle
// (a Python arm must never disturb the sibling helpers).
test("frozen guard: csSignatureFromSpanText is undisturbed (expression-bodied member slice)", () => {
  assert.strictEqual(
    csSignatureFromSpanText("public int Foo() => 1;"),
    "public int Foo()",
    "the C# slicer keeps its exact behavior; a Python arm did not move C# bytes",
  );
});

// ===========================================================================
// 2. F1 — declarationHeadLine(getLine, startLine, nameLine, lineComments?).
//    The fix is OPT-IN via lineComments (default []). Prove BOTH directions
//    from the SAME input, so the fix is provably scoped and C#'s #region/#pragma
//    stay safe (they pass []).
// ===========================================================================

const linesOf = (arr) => (n) => arr[n];
const F1_INPUT = ["@decorator", "# a comment", "def f(): ..."]; // start=0, name=2

test("F1 RESOLVED: with lineComments=['#'] the bare '#' comment in decorator trivia is walked -> head 2 (the def)", () => {
  const head = declarationHeadLine(linesOf(F1_INPUT), 0, 2, ["#"]);
  assert.strictEqual(
    head,
    2,
    `a '#' comment between decorator and def must be walked to the def line when lineComments=['#']; expected 2, got ${head}`,
  );
});

test("F1 opt-in proof: WITHOUT the arg (default []) the SAME input keeps legacy behavior -> head 1 (unchanged)", () => {
  // The trivia walk knows '@' but not a bare '#', so it stops ON the comment
  // line. This legacy value is what proves the fix is opt-in: default callers
  // (Rust/TS/C#) are byte-identical.
  const head = declarationHeadLine(linesOf(F1_INPUT), 0, 2);
  assert.strictEqual(
    head,
    1,
    `with the default lineComments the '#' line still stops the walk (legacy); expected 1, got ${head}`,
  );
});

test("F1 opt-in proof: explicit [] behaves identically to the omitted arg (C#/Rust/TS stay safe)", () => {
  const withEmpty = declarationHeadLine(linesOf(F1_INPUT), 0, 2, []);
  const omitted = declarationHeadLine(linesOf(F1_INPUT), 0, 2);
  assert.strictEqual(
    withEmpty,
    omitted,
    `lineComments=[] must be byte-identical to omitting the arg; got [] -> ${withEmpty}, omitted -> ${omitted}`,
  );
});

test("F1: with ['#'], a '#' comment inside STACKED decorators is walked to the def", () => {
  const stacked = ["@a", "# note", "@b", "def f(): ..."]; // start=0, name=3
  const head = declarationHeadLine(linesOf(stacked), 0, 3, ["#"]);
  assert.strictEqual(head, 3, `'#' inside stacked decorators must be walked; expected head=3 (def), got ${head}`);
});

// C#-safety: a '#region'/'#pragma' line must NOT be swallowed when the caller
// passes [] (the C# path). This pins that the fix cannot regress C# even though
// C# directives start with a bare '#'.
test("F1 C#-safety: default [] does NOT skip a '#region' line (C# passes [], so its directives are untouched)", () => {
  // C# passes []; the '#region' at line 1 is NOT a lineComments token, so the
  // walk stops there exactly as it does today (legacy), never silently skipped.
  const cs = ["[Serializable]", "#region Foo", "public void M() {}"]; // start=0, name=2
  const head = declarationHeadLine(linesOf(cs), 0, 2);
  assert.ok(
    head <= 2,
    `safety: head must never exceed nameLine; got ${head}`,
  );
  assert.notStrictEqual(
    head,
    2,
    `with default [] a '#region' is NOT treated as a skippable comment (it stops the walk like today); a head of 2 would mean it was silently skipped — the exact C# regression the language-scoped default prevents. got ${head}`,
  );
});
