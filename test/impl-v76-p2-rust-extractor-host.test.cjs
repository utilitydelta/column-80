// The Rust extractor is one instance per extension host.
//
// Why: the macro-member memo is keyed on the extractor object. FIM calls
// `extractorFor(languageId)` on every keystroke, so a fresh RaCommandExtractor
// per call never hits the memo and re-asks references() and completion each
// time. Other languages hold no memo and keep a fresh instance per call.
//
// Drives the product registry under a vscode stub that counts dispatches.
//
// Run: node --test test/impl-v76-p2-rust-extractor-host.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const tag = "impl-v76-p2-rust-extractor-host";
const entry = path.join(__dirname, `.${tag}.entry.ts`);
const stub = path.join(__dirname, `.${tag}.vscode-stub.cjs`);
const outfile = path.join(__dirname, `.${tag}.bundle.cjs`);

// The bundle inlines its own copy of the stub, so the handler slot lives on
// globalThis where this file's require() of the stub reaches the same one.
fs.writeFileSync(
  stub,
  `class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(s, e) { this.start = s; this.end = e; } }
const state = (globalThis.__v76RustHostState ??= { handler: async () => undefined });
module.exports = {
  __state: state,
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s, fsPath: s }) },
  commands: { executeCommand: (...a) => state.handler(...a) },
  workspace: { textDocuments: [], getConfiguration: () => ({ get: () => undefined }) },
};
`,
);
fs.writeFileSync(
  entry,
  `export { extractorFor } from "../src/vscode/extractors";
export { macroMembersViaPath } from "../src/core/macroMembers";
`,
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: stub } });
const mod = require(outfile);
const vscode = require(stub);
test.after(() => {
  for (const f of [entry, stub, outfile]) fs.rmSync(f, { force: true });
});

const DEF = "file:///ids.rs";
const USE = "file:///key.rs";
const loc = (uri, s, e) => ({ uri: { toString: () => uri }, range: { start: { line: 0, character: s }, end: { line: 0, character: e } } });

test("two extractorFor('rust') calls return the same instance", () => {
  assert.strictEqual(mod.extractorFor("rust"), mod.extractorFor("rust"));
});

test("two keystrokes through extractorFor('rust') make one references() ask", async () => {
  const calls = { references: 0, completion: 0 };
  vscode.__state.handler = async (command) => {
    if (command === "vscode.executeReferenceProvider") {
      calls.references++;
      return [loc(DEF, 12, 20), loc(USE, 17, 25)];
    }
    if (command === "vscode.executeCompletionItemProvider") {
      calls.completion++;
      return { items: [{ label: "new", detail: "const fn(v: u128) -> TenantId", kind: 1 }] };
    }
    return undefined;
  };
  const files = { [DEF]: "newtype_id!(TenantId);\n", [USE]: "fn f() { let t = TenantId::new(1); }\n" };
  const openFile = async (u) => files[u];
  const cursor = { uri: DEF, line: 0, character: 12 };
  await mod.macroMembersViaPath(mod.extractorFor("rust"), cursor, "TenantId", openFile, () => 0);
  await mod.macroMembersViaPath(mod.extractorFor("rust"), cursor, "TenantId", openFile, () => 1);
  assert.deepEqual(calls, { references: 1, completion: 1 });
});

test("typescript keeps a fresh instance per call", () => {
  assert.notStrictEqual(mod.extractorFor("typescript"), mod.extractorFor("typescript"));
});
