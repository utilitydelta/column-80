// Implementer oracle: the extractor registry (v9 phase 1, review finding 1).
// Injection gates key on extractorFor, never on oracleFor, so a language that
// gains an oracle before its extractor keeps the injection gesture dark.
// Bundled against a minimal vscode stub (the registry itself never dispatches
// a command at construction).
//
// Run: SKIP_LIVE=1 node --test test/impl-v9-extractors.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".impl-v9-extractors-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = {
    commands: { executeCommand: async () => { throw new Error("no command dispatch at construction"); } },
    workspace: { openTextDocument: async () => { throw new Error("no doc open at construction"); } },
    Uri: { parse: (s) => ({ raw: s, toString: () => s }) },
  };\n`,
);

const ENTRY = path.join(__dirname, ".impl-v9-extractors.entry.ts");
const BUNDLE = path.join(__dirname, ".impl-v9-extractors.bundle.cjs");
fs.writeFileSync(ENTRY, `export { extractorFor } from "../src/vscode/extractors";\n`);
esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: BUNDLE,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const { extractorFor } = require(BUNDLE);
test.after(() => {
  for (const f of [STUB, ENTRY, BUNDLE]) {
    fs.rmSync(f, { force: true });
  }
});

test("extractorFor('rust') returns a full SurfaceExtractor without touching vscode", () => {
  const extractor = extractorFor("rust");
  assert.ok(extractor, "rust has a registered extractor");
  for (const method of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport"]) {
    assert.strictEqual(typeof extractor[method], "function", `${method} present`);
  }
});

// v9 phase 3 flip (predicted breakage, deliberate): the four TS-server ids
// now carry a full extractor. Untyped-JS honesty lives in the transport (an
// inferred-any receiver resolves []), not in the registry gate.
test("the four TS/JS ids return a full SurfaceExtractor without touching vscode", () => {
  for (const id of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
    const extractor = extractorFor(id);
    assert.ok(extractor, `${id} has a registered extractor`);
    for (const method of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport", "membersOfType"]) {
      assert.strictEqual(typeof extractor[method], "function", `${id}.${method} present`);
    }
  }
});

test("languages without a registered extractor stay dark", () => {
  // v11 phase 4 flipped extractorFor('python') live, so python now resolves a
  // PyCommandExtractor; only genuinely unregistered ids stay dark.
  for (const id of ["plaintext", ""]) {
    assert.strictEqual(extractorFor(id), undefined, `no extractor for ${id || "(empty)"}`);
  }
});
