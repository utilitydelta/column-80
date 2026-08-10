// Implementer's LIVE falsification for the completion-signature parser: the one
// the fake-runner blind suite structurally CANNOT reach — the resolved
// documentation comes back in a DIFFERENT shape depending on the client's
// advertised documentationFormat, and the product transport rides the
// ms-dotnettools extension, which advertises MARKDOWN. This drives the REAL
// Roslyn LS under BOTH ["markdown"] and ["plaintext"], captures the resolved
// `documentation` for the same member, and proves csSignatureFromDocumentation
// extracts the SAME clean, fence-stripped core signature from each — never the
// literal "```csharp" (the green-but-wrong defect the review caught).
//
// Gated: registered in package.json test:live only. Cold init ~12s.
// Run: node --test --test-concurrency=1 test/impl-v10-csextractor-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
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
    "impl-v10-cslsp-sig",
    `export * as cs from "../src/core/csExtraction";\n`
  ));
} catch (e) {
  bundleError = e;
  cleanup = () => {
    fs.rmSync(path.join(__dirname, ".impl-v10-cslsp-sig.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".impl-v10-cslsp-sig.bundle.cjs"), { force: true });
  };
}
const { cs = {} } = mod;
const dllMissing = !fs.existsSync(ROSLYN_DLL) ? `Roslyn LS not found at ${ROSLYN_DLL}` : undefined;

test.after(() => cleanup());

test("bundle: csExtraction builds headless (csSignatureFromDocumentation exported) [surface: 'csExtraction']", () => {
  if (bundleError) assert.fail(`bundle failed: ${bundleError.message}`);
  assert.strictEqual(typeof cs.csSignatureFromDocumentation, "function", "exports csSignatureFromDocumentation");
});

const gtest = (name, fn) =>
  test(name, async (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (dllMissing) return ctx.skip(dllMissing);
    return fn(ctx);
  });

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
const PROGRAM = [
  "using System;",
  "using Newtonsoft.Json;",
  "",
  "class Greeter",
  "{",
  "    public string ToJson()",
  "    {",
  "        return JsonConvert.",
  "    }",
  "}",
].join("\n");

let projectRoot;
const buildProject = () => {
  if (projectRoot) return projectRoot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v10-cssig-"));
  fs.writeFileSync(path.join(root, "SpikeApp.csproj"), CSPROJ);
  fs.writeFileSync(path.join(root, "Program.cs"), PROGRAM + "\n");
  execFileSync("dotnet", ["restore"], { cwd: root, timeout: 180000, stdio: "ignore" });
  projectRoot = root;
  return root;
};

// A tiny raw LSP driver: resolve SerializeObject's documentation under a chosen
// documentationFormat, then tear down. Returns the resolved documentation value.
async function resolvedDocUnder(format) {
  const root = buildProject();
  const file = "file://" + path.join(root, "Program.cs");
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v10-cssig-log-"));
  const proc = spawn("dotnet", [ROSLYN_DLL, "--stdio", "--logLevel", "Warning", "--extensionLogDirectory", logDir], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  let projInit = false;
  const send = (o) => {
    const s = JSON.stringify(o);
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  };
  const request = (method, params, t = 60000) => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((res, rej) => {
      pending.set(id, res);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rej(new Error(method + " timeout"));
        }
      }, t);
    });
  };
  const notify = (m, p) => send({ jsonrpc: "2.0", method: m, params: p });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  proc.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const s = buf.indexOf("\r\n\r\n");
      if (s < 0) return;
      const h = buf.slice(0, s).toString();
      const m = /Content-Length: (\d+)/i.exec(h);
      if (!m) {
        buf = buf.slice(s + 4);
        continue;
      }
      const len = +m[1];
      if (buf.length < s + 4 + len) return;
      const body = buf.slice(s + 4, s + 4 + len).toString();
      buf = buf.slice(s + 4 + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const res = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg);
      } else if (msg.method) {
        if (msg.method === "workspace/projectInitializationComplete") projInit = true;
        if (msg.id !== undefined) {
          if (msg.method === "workspace/configuration") send({ jsonrpc: "2.0", id: msg.id, result: (msg.params.items || []).map(() => null) });
          else send({ jsonrpc: "2.0", id: msg.id, result: null });
        }
      }
    }
  });
  proc.stderr.on("data", () => {});
  try {
    await request(
      "initialize",
      {
        processId: process.pid,
        rootUri: "file://" + root,
        workspaceFolders: [{ uri: "file://" + root, name: "s" }],
        capabilities: {
          window: { workDoneProgress: true },
          workspace: { configuration: true },
          textDocument: {
            completion: { completionItem: { snippetSupport: false, documentationFormat: [format], resolveSupport: { properties: ["documentation", "detail"] } } },
          },
        },
      },
      60000
    );
    notify("initialized", {});
    notify("project/open", { projects: ["file://" + path.join(root, "SpikeApp.csproj")] });
    notify("textDocument/didOpen", { textDocument: { uri: file, languageId: "csharp", version: 1, text: PROGRAM + "\n" } });
    for (let i = 0; i < 120 && !projInit; i++) await sleep(500);
    let items = [];
    for (let attempt = 0; attempt < 8 && items.length === 0; attempt++) {
      const c = await request("textDocument/completion", {
        textDocument: { uri: file },
        position: { line: 7, character: 27 },
        context: { triggerKind: 2, triggerCharacter: "." },
      });
      items = (c.result && (c.result.items || c.result)) || [];
      if (items.length === 0) await sleep(200);
    }
    const ser = items.find((i) => i.label === "SerializeObject");
    assert.ok(ser, `SerializeObject present under ${format}`);
    const r = await request("completionItem/resolve", ser);
    const doc = r.result && r.result.documentation;
    return typeof doc === "string" ? doc : doc && doc.value;
  } finally {
    proc.kill();
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

test.after(() => {
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true });
});

gtest("live signature parity: markdown-fenced AND plaintext resolved documentation both parse to the SAME clean signature (never '```csharp') [surface: brief-1 corrected: product rides markdown]", async () => {
  const [mdDoc, plainDoc] = await Promise.all([resolvedDocUnder("markdown"), resolvedDocUnder("plaintext")]);
  // Prove the shapes genuinely differ (the falsification is only meaningful if
  // the markdown form really is fenced).
  assert.ok(/^```csharp/.test(mdDoc), `the markdown form is fenced, got ${JSON.stringify(mdDoc.slice(0, 40))}`);
  assert.ok(!/^```/.test(plainDoc), `the plaintext form is not fenced, got ${JSON.stringify(plainDoc.slice(0, 40))}`);

  const mdSig = cs.csSignatureFromDocumentation(mdDoc);
  const plainSig = cs.csSignatureFromDocumentation(plainDoc);
  for (const [label, sig] of [["markdown", mdSig], ["plaintext", plainSig]]) {
    assert.ok(typeof sig === "string", `${label}: a signature is extracted`);
    assert.notStrictEqual(sig, "```csharp", `${label}: the fence marker is NEVER the signature`);
    assert.ok(!sig.includes("```"), `${label}: no fence marker leaks, got ${JSON.stringify(sig)}`);
    assert.ok(/SerializeObject\(object\?? value\)/.test(sig), `${label}: the core signature is present, got ${JSON.stringify(sig)}`);
  }
  // The two forms are not byte-identical (markdown drops the "(+ N overloads)"
  // suffix below the fence), so parity is on the CORE signature, not bytes.
  assert.ok(mdSig.startsWith("string JsonConvert.SerializeObject(object? value)"), `markdown core signature, got ${JSON.stringify(mdSig)}`);
});
