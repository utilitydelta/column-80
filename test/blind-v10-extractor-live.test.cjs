// Blind oracle (LIVE): the C# HEADLESS transport CsLspExtractor
// (src/core/csLspExtractor.ts) against the REAL Roslyn LS, spawned from the
// user's installed C# extension dir over --stdio. This is the falsification the
// fake-runner unit suite (blind-v10-csextractor) cannot reach: real member sets
// on a broken buffer, real completionItem/resolve signatures, the real
// fully-qualify action. Gated: registered in package.json test:live only.
//
// Never read src/**. Expected RED until csLspExtractor lands. The bundle guard
// keeps the red informative: one failing surface test, the rest skip.
//
// Sourcing (scout killshot, absorbed): spawn the LS from the installed
// extension dir; do NOT try to pin it from nuget.org. Project init is
// 12s COLD / ~3.4s WARM, so the timeouts here are deliberately generous.
//
// Run: node --test --test-concurrency=1 test/blind-v10-extractor-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const ROSLYN_DLL = path.join(
  os.homedir(),
  ".vscode/extensions/ms-dotnettools.csharp-2.140.9-linux-x64/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"
);

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v10-cslsp",
    `export { CsLspExtractor } from "../src/core/csLspExtractor";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".blind-v10-cslsp.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v10-cslsp.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.CsLspExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no CsLspExtractor class");
}
const { CsLspExtractor } = mod;

// If the LS binary is not installed, the whole live suite is environment-absent,
// not a contract failure: skip loudly rather than fail.
const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;

test("bundle: the v10 C# headless transport builds (CsLspExtractor exported) [surface: 'csLspExtractor.ts']", () => {
  if (bundleError) assert.fail(`the C# headless transport is not implemented yet: ${bundleError.message}`);
});

const gtest = (name, fn) =>
  test(name, async (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (dllMissing) return ctx.skip(dllMissing);
    return fn(ctx);
  });

// ---------------------------------------------------------------------------
// A real, restorable scratch project with a broken (mid-edit) buffer that pins
// a NuGet type (Newtonsoft.Json) — the cross-package surface the extractor
// exists to serve. Built once, torn down in test.after.
// ---------------------------------------------------------------------------

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`;

// Broken buffer: two member-`.` sites with nothing after the dot, and a
// WordCount body using an unimported-but-resolvable JObject.
const PROGRAM = [
  "using System;", // 0
  "using Newtonsoft.Json;", // 1
  "", // 2
  "class Greeter", // 3
  "{", // 4
  "    private readonly string _name;", // 5
  "    public Greeter(string name) { _name = name; }", // 6
  "    public string Greet() => $\"hello {_name}\";", // 7
  "", // 8
  "    public string ToJson()", // 9
  "    {", // 10
  "        return JsonConvert.", // 11  cursor after the dot (char 27)
  "    }", // 12
  "", // 13
  "    public object Make()", // 14
  "    {", // 15
  "        return new JObject();", // 16  JObject unimported (Newtonsoft.Json.Linq)
  "    }", // 17
  "}", // 18
].join("\n");

let projectRoot;
let programUri;
const buildProject = () => {
  if (projectRoot) return projectRoot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v10-cslive-"));
  fs.writeFileSync(path.join(root, "SpikeApp.csproj"), CSPROJ);
  fs.writeFileSync(path.join(root, "Program.cs"), PROGRAM + "\n");
  execFileSync("dotnet", ["restore"], { cwd: root, timeout: 180000, stdio: "ignore" });
  projectRoot = root;
  programUri = pathToFileURL(path.join(root, "Program.cs")).href;
  return root;
};

// Start options: a superset the headless transport is expected to accept
// (projectRoot to load, the csproj URI to `project/open`, the installed LS dll).
// The implementer's start() consumes what it needs; extras are inert.
let exP;
const extractor = () =>
  (exP ||= (async () => {
    const root = buildProject();
    const ex = await CsLspExtractor.start({
      projectRoot: root,
      csproj: pathToFileURL(path.join(root, "SpikeApp.csproj")).href,
      serverDll: ROSLYN_DLL,
    });
    await ex.whenReady();
    return ex;
  })());

// Cursor after the nth single-line needle in the program text.
const posAfter = (needle) => {
  const idx = PROGRAM.indexOf(needle);
  assert.ok(idx >= 0, `needle not found: ${needle}`);
  const before = PROGRAM.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  const character = idx - (before.lastIndexOf("\n") + 1) + needle.length;
  return { uri: programUri, line, character };
};
const byName = (ms, n) => ms.find((m) => m.name === n);
const names = (ms) => ms.map((m) => m.name);

test.after(async () => {
  try {
    if (exP) (await exP).dispose();
  } catch {}
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
  cleanup();
});

// ===========================================================================
// The six primitives against the REAL Roslyn LS.
// ===========================================================================

gtest("live start: resolves the LS and carries the six primitives + lifecycle [surface: 'SurfaceExtractor' + 'csLspExtractor']", async () => {
  const ex = await extractor();
  for (const m of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport", "membersOfType"]) {
    assert.strictEqual(typeof ex[m], "function", `primitive ${m}`);
  }
  assert.strictEqual(typeof ex.dispose, "function", "dispose");
});

gtest("live completeMembers: a NuGet static type `.` site returns the real member set with resolved signatures [surface: brief-1 'JsonConvert. -> the real cross-package set']", async () => {
  const ex = await extractor();
  const members = await ex.completeMembers(posAfter("        return JsonConvert."));
  assert.ok(Array.isArray(members) && members.length > 0, `a real member set, got ${members.length}`);
  const ser = byName(members, "SerializeObject");
  assert.ok(ser, `SerializeObject is in the real set, got ${JSON.stringify(names(members).slice(0, 30))}`);
  assert.strictEqual(ser.kind, "method");
  assert.ok(
    typeof ser.signature === "string" && /SerializeObject\(/.test(ser.signature),
    `the resolved signature carries the real param list, got ${JSON.stringify(ser.signature)}`
  );
  // Object-noise names may be present in the raw completion set (verbatim contract);
  // the domain members are what must be there.
  assert.ok(byName(members, "DeserializeObject"), "DeserializeObject is in the set too");
});

gtest("live completeMembers: a non-member site returns [] (the member-site gate) [surface: brief-1 'member-site gate']", async () => {
  const ex = await extractor();
  // Column 8: inside the `return ` keyword, not after `identifier.`.
  const members = await ex.completeMembers({ uri: programUri, line: 11, character: 8 });
  assert.deepStrictEqual(members, [], "not a member site -> no members");
});

gtest("live hoverSurface: a resolved symbol yields signature (+doc when present), example undefined [surface: '2. hoverSurface']", async () => {
  const ex = await extractor();
  const h = await ex.hoverSurface({ uri: programUri, line: 11, character: 20 }); // on JsonConvert
  assert.ok(h, "hover resolves a surface");
  assert.ok(typeof h.signature === "string" && /JsonConvert/.test(h.signature), `signature names the symbol, got ${JSON.stringify(h.signature)}`);
  assert.strictEqual(h.example, undefined, "example is always undefined for C#");
});

gtest("live definition: a NuGet symbol resolves INTO decompiled metadata-as-source [surface: '3. definition' + brief 'metadata-as-source']", async () => {
  const ex = await extractor();
  const def = await ex.definition({ uri: programUri, line: 11, character: 20 }); // JsonConvert
  assert.ok(def, "the dep symbol resolves to a location");
  assert.ok(typeof def.uri === "string" && def.uri.startsWith("file://"), `a file:// uri, got ${JSON.stringify(def.uri)}`);
  assert.ok(/MetadataAsSource/i.test(fileURLToPath(def.uri)) || /JsonConvert/i.test(def.uri), `lands in decompiled metadata, got ${def.uri}`);
  for (const k of ["startLine", "startCharacter", "endLine", "endCharacter"]) {
    assert.strictEqual(typeof def.range[k], "number", `range.${k} is a number`);
  }
});

gtest("live example: ALWAYS undefined [surface: '4. example — always dark']", async () => {
  const ex = await extractor();
  assert.strictEqual(await ex.example(posAfter("        return JsonConvert.")), undefined);
  assert.strictEqual(await ex.example({ uri: programUri, line: 11, character: 20 }, "JsonConvert"), undefined, "prefer ignored");
});

gtest("live qualifyImport: an unimported-but-resolvable name yields the in-span fully-qualify edit [surface: '5. qualifyImport' + brief 'the fully-qualify action']", async () => {
  const ex = await extractor();
  // On JObject in `return new JObject();` (line 16). Find its column.
  const line = PROGRAM.split("\n")[16];
  const col = line.indexOf("JObject") + 1;
  const edit = await ex.qualifyImport({ uri: programUri, line: 16, character: col });
  assert.ok(edit, "a resolvable-but-unimported name has a deterministic qualify fix");
  assert.ok(typeof edit.newText === "string" && /Newtonsoft\.Json\.Linq\./.test(edit.newText), `the fix qualifies with the real namespace, got ${JSON.stringify(edit.newText)}`);
  // In-span: the edit sits at/near the identifier line, not a top-of-file using line.
  assert.ok(edit.range.startLine >= 14, `the edit is in-span (not the imports region), got startLine ${edit.range.startLine}`);
});

gtest("live membersOfType: documentSymbol descent of the local class -> its declared members [surface: '6. membersOfType']", async () => {
  const ex = await extractor();
  const members = await ex.membersOfType({ uri: programUri, line: 3, character: 8 }); // inside class Greeter
  const got = names(members);
  assert.ok(byName(members, "Greet"), `the declared method, got ${JSON.stringify(got)}`);
  assert.strictEqual(byName(members, "Greet").kind, "method");
  assert.ok(byName(members, "ToJson"), "another declared method");
  assert.ok(byName(members, "_name"), "the declared field");
  assert.strictEqual(byName(members, "_name").kind, "field");
});
