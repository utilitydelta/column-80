import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/vscode/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: !watch,
};

// The VS Code integration tier drives the REAL transports inside a real
// extension host, so it needs them as CJS with `vscode` left external for the
// host to supply. A stdin entry keeps the tier's re-export list out of src/,
// where it would read as production surface.
const productSurface = {
  stdin: {
    contents: [
      `export { extractorFor } from "./src/vscode/extractors";`,
      `export { findTypeAnchorInText, pyFindTypeAnchorInText, goFindTypeAnchorInText } from "./src/core/fimWholeBlock";`,
      `export { renderMemberSignatures } from "./src/core/extraction";`,
      `export { INJECTION_DEADLINE_MS } from "./src/core/completionService";`,
      `export { ARG_TYPE_DEADLINE_MARGIN_MS, ARG_TYPE_MIN_BUDGET_MS, argTypeMinBudgetMs, MAX_ARG_TYPES, resolveArgTypesInBudget } from "./src/core/argTypeSurface";`,
      `export { argumentTypeNames, lineCommentFor, memberSiteFor, narrowToPartial, renderFimCandidates } from "./src/core/fimInject";`,
      // session-v32 item 1: the doc-comment attachment pass decides which symbol
      // EVERY gesture aims at, and whether a doc comment sits inside a symbol's
      // range is decided by the language server. Headless fixtures encode what
      // the servers were measured to do; only the tier can catch them drifting.
      `export { resolveFunctionAtCursor, resolveBlockAtCursor } from "./src/vscode/fnGen";`,
      // session-v61: the criticize rubric. The tier grades ONE thing headless
      // tests cannot reach - the span a live language server returns, fed to
      // the real slicer. A slice that begins at the declaration head reads 29%
      // of documented Rust functions as undocumented, and this session's rig
      // hit that twice against fixtures. Only a real server can say whether the
      // product's own span still walks up to the doc comment.
      `export { sliceFunction } from "./src/core/criticizeSlice";`,
      `export { scoreFunction, signatureLevel, DEFAULT_ELEVATION } from "./src/core/criticizeScore";`,
      `export { criticizeLangFor } from "./src/core/criticizeLang";`,
      `export { renderScorecard, HONEST_CONTRACT } from "./src/core/criticizeRender";`,
      `export { CRITIQUE_PREFIX, RUBRIC_SIZE, NO_FUNCTION_REASON, unregisteredLanguageReason, unregisteredLanguageToast } from "./src/core/criticizeGesture";`,
    ].join("\n"),
    resolveDir: ".",
    loader: "ts",
  },
  bundle: true,
  outfile: "test-vscode/.build/product.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
};

if (watch) {
  // Both bundles, or the integration tier grades a frozen copy of src/ for as
  // long as the watch runs.
  const ctxs = await Promise.all([options, productSurface].map((o) => esbuild.context(o)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching...");
} else {
  await esbuild.build(options);
  await esbuild.build(productSurface);
  console.log("build complete");
}
