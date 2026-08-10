// Shared mechanics for the blind-* contract tests. Copies the
// harness.test.cjs pattern: bundle src/core modules with esbuild into a
// throwaway .cjs and require it headless. Blind-oracle discipline: nothing
// here reads src/** contents; esbuild resolves modules at bundle time only.
// Dot-prefixed so `node --test` does not treat this file as a test.

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// Bundles the given TS entry source (re-exports from ../src/core/*) and
// requires the result. Returns { mod, cleanup }; call cleanup in test.after.
function bundleCore(tag, entrySource) {
  const entry = path.join(__dirname, `.${tag}.entry.ts`);
  const outfile = path.join(__dirname, `.${tag}.bundle.cjs`);
  fs.writeFileSync(entry, entrySource);
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
  });
  const mod = require(outfile);
  const cleanup = () => {
    fs.rmSync(entry, { force: true });
    fs.rmSync(outfile, { force: true });
  };
  return { mod, cleanup };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { bundleCore, sleep };
