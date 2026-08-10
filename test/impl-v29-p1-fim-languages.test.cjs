// White-box companion to the v29 phase-1 blind contract.
//
// The blind file pins the SHAPE of the answer: which ids are served, how the
// widening setting behaves. This file pins the one thing that cannot be pinned
// from outside, and the one that will actually rot: FIM_LANGUAGES is supposed
// to BE the set of languages with a registered oracle or extractor, and nothing
// enforces that but a test. A sixth language arriving behind the seams with no
// row here is a language whose oracle runs and whose FIM is dark.
//
// oracleFor is core, so it bundles headless. extractorFor is not (it imports
// vscode), so the extractor half is asserted through the ids the extractor
// registry dispatches on, which are the same five by construction; see
// src/vscode/extractors.ts.

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v29-p1",
  `export { FIM_LANGUAGES, fimServesLanguage } from "../src/core/fimLanguages";
   export { oracleFor } from "../src/core/compilerOracle";
   export { TS_LANGUAGE_IDS } from "../src/core/tsExtraction";`,
);

test.after(cleanup);

// Every language the compiler oracle answers for must be served. This is the
// direction that matters: an oracle without FIM is a language the product
// claims to understand and then goes dark in.
test("every language with a registered oracle is served by FIM", () => {
  for (const id of mod.FIM_LANGUAGES) {
    assert.ok(mod.oracleFor(id) !== undefined, `${id} is served by FIM but has no oracle`);
  }
});

// And the reverse, over a universe wide enough to catch a sixth language
// arriving: nothing may have an oracle and not be served.
test("no language has an oracle and no FIM", () => {
  const universe = [
    "rust", "csharp", "python", "go", "typescript", "typescriptreact", "javascript",
    "javascriptreact", "c", "cpp", "java", "kotlin", "swift", "scala", "php", "dart",
    "ruby", "shellscript", "bash", "lua", "sql", "haskell", "clojure", "powershell",
    "zig", "ocaml", "fsharp", "elixir", "erlang", "julia", "nim", "crystal", "vb",
    "markdown", "plaintext", "json", "jsonc", "yaml", "xml", "toml", "ini", "latex",
    "asciidoc", "restructuredtext", "log", "git-commit", "scminput", "makefile",
    "dockerfile", "properties", "csv", "bibtex",
  ];
  for (const id of universe) {
    if (mod.oracleFor(id) !== undefined) {
      assert.ok(
        mod.FIM_LANGUAGES.has(id),
        `${id} has a registered oracle but FIM does not serve it`,
      );
    }
  }
});

// The TS family travels as one id set, not as a hand-copied list. Two lists of
// the same four ids is the drift this import exists to prevent.
test("the whole TypeScript family is served, from the one id set", () => {
  for (const id of mod.TS_LANGUAGE_IDS) {
    assert.ok(mod.FIM_LANGUAGES.has(id), `${id} is in TS_LANGUAGE_IDS but not served`);
    assert.ok(mod.fimServesLanguage(id));
  }
});

// The exported set is a copy of the gate's own, so a caller that adds to it
// widens nothing. Object.freeze does not stop Set.add (it seals own properties,
// not the internal slots), which is why this is a copy rather than a freeze.
test("mutating the exported set changes no answer", () => {
  try {
    mod.FIM_LANGUAGES.add("markdown");
  } catch {
    // A future implementation may make it genuinely immutable. Either outcome
    // satisfies the property this test is about.
  }
  assert.equal(mod.fimServesLanguage("markdown"), false);
});
