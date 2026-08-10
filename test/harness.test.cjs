// Harness smoke oracle: proves the test wiring itself — a .cjs node:test file
// can bundle a src/core module with esbuild and import it headless. This is
// the pattern every phase-1 unit oracle will use (donor: human-replay).
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const bundle = path.join(__dirname, ".harness.bundle.cjs");
const entry = path.join(__dirname, ".harness.entry.ts");
fs.writeFileSync(entry, `export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: "cjs", platform: "node" });
const { DEFAULT_FIM_CONFIG } = require(bundle);
test.after(() => {
  fs.rmSync(bundle, { force: true });
  fs.rmSync(entry, { force: true });
});

test("core config bundles headless and carries the phase-1 defaults", () => {
  assert.strictEqual(DEFAULT_FIM_CONFIG.model, "qwen2.5-coder:1.5b-base");
  assert.strictEqual(DEFAULT_FIM_CONFIG.apiBase, "http://localhost:11434");
});
