// Blind oracle (LIVE): v10 phase 4 gesture wiring that only a REAL C# surface
// can falsify - the two forks whose honest contract is positive and needs the
// Roslyn LS / dotnet, so they cannot be pinned headlessly (see the note in
// blind-v10-gestures.test.cjs, contract 3):
//
//   F3b  C# fn-gen PREFILL is its own lang entry, signatures-only: a csharp
//        fn-gen whose signature names a resolvable user type injects a ```cs-
//        (or ```csharp-)fenced prefill block carrying the type's REAL member
//        signatures - never ```rust, never the Rust worked-example fallback.
//        Today csharp -> RUST_PREFILL_LANG, whose candidate parser cannot read a
//        C# type-first signature, so NOTHING resolves and the prefill is empty.
//   F3c  C# compiler-directed REPAIR resolves a member surface: a REAL CS1061
//        (member-does-not-exist) routed through resolveSurfaceInjection over the
//        real receiver injects that receiver's real members. Today csharp falls
//        to the rustc-shaped classifier that cannot read a CS#### code.
//   F3d  (characterization) the Rust unresolvedNameCursor heuristic does NOT
//        transfer to a real CS0246/CS0103 message, so csharp needs its own
//        cursor variant at the repair dispatch (oracleSurface.ts:710). Pinned as
//        a live characterization against the REAL dotnet diagnostic text.
//
// Never read src/**. Expected RED until phase 4 wires the csharp branches. The
// bundle guards keep the red informative; environment absence (no LS / no
// dotnet) SKIPS loudly rather than fails.
//
// Gated: registered in package.json test:live only.
// Run: node --test --test-concurrency=1 test/blind-v10-gestures-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll",
);

// ---------------------------------------------------------------------------
// Bundle 1: the REAL headless C# transport (no vscode) + the Rust cursor export.
// ---------------------------------------------------------------------------
let core = {};
let coreCleanup = () => {};
let coreErr;
try {
  ({ mod: core, cleanup: coreCleanup } = bundleCore(
    "blind-v10-gestures-live-core",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n` +
      `export { unresolvedNameCursor } from "../src/core/compilerDirected";\n`,
  ));
} catch (e) {
  coreErr = e;
}

// ---------------------------------------------------------------------------
// Bundle 2: resolvePrefill + resolveSurfaceInjection vs a structural vscode stub
// (Position/Range/Uri + workspace.openTextDocument answering from a doc map).
// ---------------------------------------------------------------------------
const STUB = path.join(__dirname, ".blind-v10-gestures-live-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position { constructor(line, character){ this.line=line; this.character=character; }
  isBefore(o){return this.line<o.line||(this.line===o.line&&this.character<o.character);} isBeforeOrEqual(o){return this.isBefore(o)||this.isEqual(o);}
  isAfter(o){return !this.isBeforeOrEqual(o);} isAfterOrEqual(o){return !this.isBefore(o);} isEqual(o){return this.line===o.line&&this.character===o.character;}
  translate(l=0,c=0){return new Position(this.line+l,this.character+c);} with(line,character){return new Position(line===undefined?this.line:line,character===undefined?this.character:character);} }
class Range { constructor(a,b,c,d){ if(typeof a==="number"){this.start=new Position(a,b);this.end=new Position(c,d);} else {this.start=a;this.end=b;} }
  contains(p){ const ps=p.start?p.start:p, pe=p.end?p.end:p;
    const geS=ps.line>this.start.line||(ps.line===this.start.line&&ps.character>=this.start.character);
    const leE=pe.line<this.end.line||(pe.line===this.end.line&&pe.character<=this.end.character); return geS&&leE; }
  with(start,end){return new Range(start||this.start,end||this.end);} }
const mkUri=(full,fsPath)=>({scheme:full.includes("://")?full.slice(0,full.indexOf("://")):"file",fsPath,path:fsPath,query:"",fragment:"",toString:()=>full,with(){return this;},toJSON(){return full;}});
const Uri={ file:(p)=>mkUri("file://"+p,p), parse:(s)=>mkUri(String(s),String(s).replace(/^[a-zA-Z+-]+:\\/\\//,"")), joinPath:(b,...s)=>Uri.file([b.fsPath,...s].join("/")) };
const disposable=()=>({dispose(){}});
class MarkdownString{constructor(v){this.value=v||"";}appendCodeblock(t,l){this.value+="\\n\`\`\`"+(l||"")+"\\n"+t+"\\n\`\`\`\\n";}appendMarkdown(t){this.value+=t;}appendText(t){this.value+=t;}}
class ThemeColor{constructor(id){this.id=id;}}
class Diagnostic{constructor(range,message,severity){this.range=range;this.message=message;this.severity=severity;}}
class EventEmitter{constructor(){this.h=[];}get event(){return (fn)=>{this.h.push(fn);return disposable();};}fire(x){for(const f of this.h)f(x);}dispose(){}}
module.exports={ Position,Range,Uri,MarkdownString,ThemeColor,Diagnostic,EventEmitter,
  DiagnosticSeverity:{Error:0,Warning:1,Information:2,Hint:3},
  SymbolKind:{Method:5,Function:11,Constructor:8,Struct:22,Enum:9,Class:4,Interface:10,Field:7,Property:6},
  CompletionItemKind:{Method:1,Function:2,Field:4,Property:9},
  OverviewRulerLane:{Left:1,Center:2,Right:4,Full:7},
  workspace:{ getConfiguration:()=>({get:(k,f)=>f,has:()=>false,inspect:()=>undefined,update:async()=>{}}),
    onDidChangeConfiguration:()=>disposable(), onDidChangeTextDocument:()=>disposable(), onDidCloseTextDocument:()=>disposable(),
    get textDocuments(){return globalThis.__CSL_OPEN__||[];},
    openTextDocument:async(arg)=>{const key=typeof arg==="string"?arg:(arg&&arg.toString?arg.toString():String(arg)); const d=(globalThis.__CSL_DOCS__||{})[key]; if(d)return d;
      return {uri:Uri.parse(key),languageId:"csharp",version:1,lineCount:0,getText:()=>"",lineAt:()=>({text:"",firstNonWhitespaceCharacterIndex:0,isEmptyOrWhitespace:true,range:new Range(0,0,0,0)}),offsetAt:()=>0,positionAt:()=>new Position(0,0)}; } },
  languages:{ createDiagnosticCollection:(name)=>({name,set(){},delete(){},clear(){},dispose(){}}), getDiagnostics:()=>[], onDidChangeDiagnostics:()=>disposable() },
  window:{ createOutputChannel:(name)=>({name,appendLine(){},append(){},replace(){},show(){},hide(){},clear(){},dispose(){}}), createTextEditorDecorationType:(o)=>({o,dispose(){}}), showInformationMessage:async()=>undefined, showWarningMessage:async()=>undefined, showErrorMessage:async()=>undefined, activeColorTheme:{kind:1} },
  commands:{ registerCommand:()=>disposable(), executeCommand:async()=>undefined },
};
`,
);
const vEntry = path.join(__dirname, ".blind-v10-gestures-live-v.entry.ts");
const vOut = path.join(__dirname, ".blind-v10-gestures-live-v.bundle.cjs");
let surf = {};
let surfErr;
try {
  fs.writeFileSync(
    vEntry,
    `export { resolvePrefill } from "../src/vscode/fnGen";\n` +
      `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n`,
  );
  esbuild.buildSync({ entryPoints: [vEntry], bundle: true, outfile: vOut, format: "cjs", platform: "node", alias: { vscode: STUB } });
  surf = require(vOut);
} catch (e) {
  surfErr = e;
}

const { CsLspExtractor, unresolvedNameCursor } = core;
const StubP = require.cache[require.resolve(STUB)] ? require(STUB) : (surfErr ? {} : require(STUB));

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
  coreCleanup();
  for (const f of [STUB, vEntry, vOut]) fs.rmSync(f, { force: true });
});

const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;
// This file is LIVE-only. The unit sweep (SKIP_LIVE=1 node --test) picks up every
// test file, so it must self-skip cleanly there - no LS spawn, no dotnet.
const SKIP_LIVE = process.env.SKIP_LIVE === "1";

test("bundle guard: the C# transport + gesture surface build headless", (ctx) => {
  if (SKIP_LIVE) return ctx.skip("SKIP_LIVE=1");
  if (coreErr) assert.fail(`core bundle failed: ${coreErr.message}`);
  if (surfErr) assert.fail(`surface bundle failed: ${surfErr.message}`);
});

const gtest = (name, fn) =>
  test(name, async (ctx) => {
    if (SKIP_LIVE) return ctx.skip("SKIP_LIVE=1");
    if (coreErr) return ctx.skip(`core bundle failed: ${coreErr.message}`);
    if (surfErr) return ctx.skip(`surface bundle failed: ${surfErr.message}`);
    if (dllMissing) return ctx.skip(dllMissing);
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// A real, restorable single-file C# project: a user type Widget with real
// members, a Handle(Widget) whose body is to be generated (F3b), and a broken
// receiver call w.Frobnicate() that yields a real CS1061 (F3c).
// ---------------------------------------------------------------------------
const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
  </PropertyGroup>
</Project>
`;
const PROGRAM = [
  "namespace Live;", // 0
  "public class Widget", // 1
  "{", // 2
  "    public int Mass() => 3;", // 3
  "    public string Label() => \"w\";", // 4
  "}", // 5
  "public class Consumer", // 6
  "{", // 7
  "    public int Handle(Widget w)", // 8   fn-gen target (F3b)
  "    {", // 9
  "        ", // 10  empty body
  "    }", // 11
  "    public int Broken(Widget w)", // 12
  "    {", // 13
  "        return w.Frobnicate();", // 14  CS1061 receiver miss (F3c)
  "    }", // 15
  "}", // 16
].join("\n");

let projectRoot;
let programUri;
let programPath;
const buildProject = () => {
  if (projectRoot) return projectRoot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v10-gestures-live-"));
  fs.writeFileSync(path.join(root, "Live.csproj"), CSPROJ);
  programPath = path.join(root, "Program.cs");
  fs.writeFileSync(programPath, PROGRAM + "\n");
  execFileSync("dotnet", ["restore"], { cwd: root, timeout: 180000, stdio: "ignore" });
  projectRoot = root;
  programUri = pathToFileURL(programPath).href;
  return root;
};

let exP;
const extractor = () =>
  (exP ||= (async () => {
    const root = buildProject();
    const ex = await CsLspExtractor.start({
      projectRoot: root,
      csproj: pathToFileURL(path.join(root, "Live.csproj")).href,
      serverDll: ROSLYN_DLL,
    });
    await ex.whenReady();
    return ex;
  })());

// A vscode-shaped document over the real file text, keyed by the real uri.
function makeDoc() {
  const text = PROGRAM + "\n";
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < Math.min(pos.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + pos.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new StubP.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new StubP.Position(lines.length - 1, lines[lines.length - 1].length);
  };
  const doc = {
    uri: StubP.Uri.parse(programUri),
    fileName: programPath,
    languageId: "csharp",
    version: 1,
    lineCount: lines.length,
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (arg) => {
      const n = typeof arg === "number" ? arg : arg.line;
      const t = lines[n] ?? "";
      const m = t.match(/\S/);
      return { lineNumber: n, text: t, range: new StubP.Range(n, 0, n, t.length), firstNonWhitespaceCharacterIndex: m ? m.index : t.length, isEmptyOrWhitespace: !m };
    },
  };
  globalThis.__CSL_DOCS__ = { [programUri]: doc };
  globalThis.__CSL_OPEN__ = [doc];
  return doc;
}

// ===========================================================================
// F3b - the real C# fn-gen prefill: signatures-only, ```cs-fenced, no ```rust.
// ===========================================================================
gtest("F3b live: a C# fn-gen prefill over a real Widget surface injects a ```cs signatures-only block (never ```rust) [surface: prefillLangFor(csharp) is a C# entry]", async () => {
  const ex = await extractor();
  const doc = makeDoc();
  const resolved = {
    span: { start: 0, end: 1 },
    signature: "public int Handle(Widget w)",
    docComment: undefined,
    symbolName: "Handle",
    languageId: "csharp",
    kind: "function",
  };
  const prefill = await surf.resolvePrefill(ex, doc, resolved, () => {});
  assert.ok(prefill, "a csharp prefill must resolve the Widget surface (today the Rust candidate parser reads no C# type-first signature, so nothing resolves)");
  assert.ok(/```(?:cs|csharp)\b/.test(prefill), `the injected block must be C#-fenced, got:\n${prefill}`);
  assert.ok(!prefill.includes("```rust"), `a C# prefill must never carry a rust fence:\n${prefill}`);
  assert.ok(/\bMass\b/.test(prefill) || /\bLabel\b/.test(prefill), `the real Widget member signatures must be injected, got:\n${prefill}`);
});

// ===========================================================================
// F3c - the real C# repair: a real CS1061 injects the receiver's real members.
// ===========================================================================
gtest("F3c live: a real CS1061 routed through resolveSurfaceInjection injects the receiver's real member surface (not classifier-dark) [surface: repairLangFor(csharp) is a C# entry]", async () => {
  const ex = await extractor();
  const doc = makeDoc();
  // The neutral Diagnostic shape (CsOracle SARIF -> repair.ts). Real CS1061 text;
  // primary span at the receiver-miss member on line 14 (0-based line 14).
  const cs1061 = {
    kind: "compile-error",
    level: "error",
    code: "CS1061",
    message:
      "'Widget' does not contain a definition for 'Frobnicate' and no accessible extension method 'Frobnicate' accepting a first argument of type 'Widget' could be found",
    spans: [{ fileName: programPath, byteStart: 0, byteEnd: 0, lineStart: 15, lineEnd: 15, columnStart: 20, columnEnd: 30, isPrimary: true }],
    suggestions: [],
  };
  let injection;
  await assert.doesNotReject(async () => {
    injection = await surf.resolveSurfaceInjection(ex, doc, [cs1061], () => {});
  }, "resolveSurfaceInjection must never throw on a real C# diagnostic");
  assert.ok(injection && injection.length > 0, "a real CS1061 must classify + inject the receiver's surface (today the rustc classifier returns nothing for a CS#### code)");
  assert.ok(/\bMass\b/.test(injection) || /\bLabel\b/.test(injection), `the real Widget members must be in the repair injection, got:\n${injection}`);
  assert.ok(!injection.includes("```rust"), "a C# repair injection must never carry a rust fence");
});

// ===========================================================================
// F3d - characterization: the Rust unresolvedNameCursor heuristic does NOT fire
// on a real CS0246/CS0103 message, so csharp needs its own cursor variant at the
// repair dispatch. (The dispatch flip itself, oracleSurface.ts:710, rides the
// repair loop above; this pins the motivating fact against real dotnet text.)
// ===========================================================================
gtest("F3d live: the Rust unresolvedNameCursor does NOT transfer to a real CS0246/CS0103 - a C# cursor variant is required [surface: oracleSurface.ts:710 fork]", async () => {
  // Real dotnet 10.0.110 message text for the two C# unresolved-name classes.
  const cs0246 = {
    spans: [{ isPrimary: true, lineStart: 11, columnStart: 9 }],
    message: "The type or namespace name 'Nonexistent' could not be found (are you missing a using directive or an assembly reference?)",
  };
  const cs0103 = {
    spans: [{ isPrimary: true, lineStart: 16, columnStart: 16 }],
    message: "The name 'Missing' does not exist in the current context",
  };
  assert.strictEqual(unresolvedNameCursor(cs0246), undefined, "the rustc 'cannot find ... in this scope' heuristic must NOT match a CS0246 message (proving the fork is real)");
  assert.strictEqual(unresolvedNameCursor(cs0103), undefined, "nor a CS0103 message - csharp needs its own cursor variant");
});
