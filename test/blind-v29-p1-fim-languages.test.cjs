// BLIND ORACLE - session-v29 item 1: FIM runs on code, and only on code.
// Black-box contract test for `src/core/fimLanguages.ts`, written against the
// contract only. This file has never read the implementation, which did not
// exist when the assertions were written, and must not be edited to make one
// pass (AGENTS.md "Rules").
//
// The surface under test: FIM_LANGUAGES and fimServesLanguage. Nothing here
// names a helper, a regex or an internal step; every assertion is a property
// the contract states.
//
// The class this exists for: the provider registers on document scheme alone,
// so FIM currently serves every language VS Code opens. Markdown, plaintext,
// latex, asciidoc, json and yaml all reach the model, and a model writing
// prose into a developer's document is the one thing the manifesto forbids.
// The product owner's line: we only FIM CODE, only in the languages we know
// are code, and never inside a comment block. This file pins the first half.
//
// Not reachable headlessly, recorded rather than faked: the PROVIDER half of
// the contract. `src/vscode/completionProvider.ts` imports `vscode`, which is
// not a resolvable package in this repo (only `@types/vscode` is installed),
// so it cannot be bundled by `bundleCore`. Whether the provider actually asks
// fimServesLanguage before the service, whether it registers a document
// selector narrowed to the served set, and what it writes to the channel when
// it goes dark on an unserved language, are all outside this file. They belong
// in an impl-level test that owns a vscode stub. This file deliberately does
// not invent one, because a hand-built stub pins the stub's shape, not the
// product's. What IS pinned here transitively: the module is vscode-free, and
// the bundle below is the proof, because a stray `vscode` import anywhere in
// its transitive graph would fail to resolve and this whole file would be red.
//
// Without the module the whole file is red at require time, with esbuild
// unable to resolve `../src/core/fimLanguages`, rather than red on an
// assertion. That shape was confirmed against a deliberately missing path.
//
// Run: SKIP_LIVE=1 node --test test/blind-v29-p1-fim-languages.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v29-p1-fim-languages",
  `export { FIM_LANGUAGES, fimServesLanguage } from "../src/core/fimLanguages";
export { TS_LANGUAGE_IDS } from "../src/core/tsExtraction";\n`,
);
const { FIM_LANGUAGES, fimServesLanguage, TS_LANGUAGE_IDS } = mod;
test.after(cleanup);

// ---- the tables, transcribed from the contract ---------------------------

// The five shipped languages, spelled as language ids. These are exactly the
// languages that have a registered oracle or extractor, which is the same
// question as "does the product understand this as code".
const SHIPPED = [
  "rust",
  "csharp",
  "python",
  "go",
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
];

// Prose and data. These are the languages the current scheme-only registration
// serves by accident, and the population this item exists to stop serving. A
// ghost here is the model writing the human's words, or inventing a value in a
// config file where a wrong value is silent and load-bearing.
const PROSE_AND_DATA = [
  "markdown",
  "plaintext",
  "latex",
  "asciidoc",
  "json",
  "jsonc",
  "yaml",
  "xml",
  "toml",
  "ini",
  "properties",
  "csv",
  "restructuredtext",
  "bibtex",
  "log",
  "git-commit",
  "scminput",
  "dockercompose",
];

// Real code with a row in the COMMENT table but no oracle and no extractor.
// The comment table answers a different question: it says how a comment is
// SPELLED where FIM runs, not WHERE FIM runs. Reusing it as the serve set
// would ship FIM into eleven languages the product has never measured, and
// would also drag `yaml`, `toml`, `dockerfile` and `makefile` in with them.
const COMMENT_TABLE_ONLY = [
  "c",
  "cpp",
  "java",
  "kotlin",
  "swift",
  "scala",
  "php",
  "dart",
  "ruby",
  "shellscript",
  "lua",
  "sql",
  "haskell",
  "clojure",
  "powershell",
  "makefile",
  "dockerfile",
  "perl",
  "r",
  "elixir",
  "elm",
  "ada",
  "lisp",
  "scheme",
  "racket",
  "bash",
];

const NOT_SERVED_BY_DEFAULT = [...PROSE_AND_DATA, ...COMMENT_TABLE_ONLY];

// ---- local mechanics for the assertions (never the module's) -------------

const sorted = (xs) => [...xs].sort();

// =========================================================================
// 1. The default set
// =========================================================================

test("FIM_LANGUAGES is a set the caller can ask about", () => {
  assert.equal(typeof FIM_LANGUAGES.has, "function");
  assert.equal(typeof FIM_LANGUAGES.size, "number");
});

test("the default set is exactly the five shipped languages", () => {
  // "exactly" is the teeth. A set that merely CONTAINS these would let a later
  // change quietly widen the serve set back toward every language VS Code
  // opens, which is the state this item exists to leave.
  assert.deepEqual(sorted(FIM_LANGUAGES), sorted(SHIPPED));
});

test("every shipped language is served with no extras at all", () => {
  for (const id of SHIPPED) {
    assert.equal(fimServesLanguage(id), true, `${id} must be served`);
  }
});

test("the TypeScript family comes from TS_LANGUAGE_IDS, not a second list", () => {
  // The existing list is the one the extractor already keys on. A hand-written
  // copy here would drift the day a fifth id is added, and the product would
  // serve a language its extractor does not cover, or cover one it will not
  // serve.
  assert.ok(TS_LANGUAGE_IDS.size > 0, "the donor list must be non-empty");
  for (const id of TS_LANGUAGE_IDS) {
    assert.equal(
      fimServesLanguage(id),
      true,
      `${id} is in TS_LANGUAGE_IDS and must be served`,
    );
    assert.ok(FIM_LANGUAGES.has(id), `${id} must be in the default set`);
  }
});

test("the four non-TypeScript oracles are each served", () => {
  for (const id of ["rust", "csharp", "python", "go"]) {
    assert.equal(fimServesLanguage(id), true, id);
  }
});

test("membership of the set and the predicate answer the same question", () => {
  // Two ways to ask, one answer. A caller that reads FIM_LANGUAGES directly
  // must not get a different serve set from a caller that asks the function.
  const probes = [...SHIPPED, ...NOT_SERVED_BY_DEFAULT, "", "notalanguage"];
  for (const id of probes) {
    assert.equal(fimServesLanguage(id), FIM_LANGUAGES.has(id), id);
  }
});

// =========================================================================
// 2. Prose and data are not code
// =========================================================================

test("prose and data languages are not served by default", () => {
  for (const id of PROSE_AND_DATA) {
    assert.equal(fimServesLanguage(id), false, `${id} must not be served`);
    assert.equal(FIM_LANGUAGES.has(id), false, `${id} must not be in the set`);
  }
});

test("markdown is not served, stated on its own", () => {
  // Named separately because it is the one the human will notice first: this
  // repo's own ARCHITECTURE.md is markdown, and every keystroke in it was
  // reaching the model.
  assert.equal(fimServesLanguage("markdown"), false);
});

// =========================================================================
// 3. A comment row is not a licence to serve
// =========================================================================

test("a language with a comment row but no oracle is still not served", () => {
  for (const id of COMMENT_TABLE_ONLY) {
    assert.equal(fimServesLanguage(id), false, `${id} must not be served`);
    assert.equal(FIM_LANGUAGES.has(id), false, `${id} must not be in the set`);
  }
});

test("an unknown language id is not served", () => {
  // Only ids that are not any VS Code language id under any normalisation. The
  // contract scopes trimming and case folding to the EXTRAS, and says nothing
  // about the languageId argument, so nothing here leans on that.
  for (const id of ["", "notalanguage", "  ", "typescriptx", "rustlang", "gomod"]) {
    assert.equal(fimServesLanguage(id), false, JSON.stringify(id));
  }
});

// =========================================================================
// 4. The setting widens, and only widens
// =========================================================================

test("an extra language id makes that language served", () => {
  assert.equal(fimServesLanguage("cpp"), false, "the precondition");
  assert.equal(fimServesLanguage("cpp", ["cpp"]), true);
});

test("an extra widens only the language it names", () => {
  assert.equal(fimServesLanguage("cpp", ["cpp"]), true);
  for (const id of ["java", "markdown", "yaml", ""]) {
    assert.equal(fimServesLanguage(id, ["cpp"]), false, id);
  }
});

test("several extras all widen", () => {
  const extra = ["cpp", "java", "markdown"];
  for (const id of extra) {
    assert.equal(fimServesLanguage(id, extra), true, id);
  }
  assert.equal(fimServesLanguage("kotlin", extra), false);
});

test("a default language stays served whatever the extras are", () => {
  // The setting is a widening, so there is no value of it that takes a shipped
  // language away. A user typing a nonsense list must not lose Rust.
  const EXTRAS = [
    [],
    ["cpp"],
    ["markdown", "plaintext"],
    ["", "   "],
    ["nonsense", "!!!", "12345"],
    ["rust"],
    ["rust", "rust", "rust"],
  ];
  for (const extra of EXTRAS) {
    for (const id of SHIPPED) {
      assert.equal(
        fimServesLanguage(id, extra),
        true,
        `${id} lost with extras ${JSON.stringify(extra)}`,
      );
    }
  }
});

test("an unrelated extras list never widens a language it does not name", () => {
  for (const id of NOT_SERVED_BY_DEFAULT) {
    assert.equal(fimServesLanguage(id, ["somethingelse"]), false, id);
  }
});

test("an empty or absent extras list is the default answer", () => {
  const probes = [...SHIPPED, ...NOT_SERVED_BY_DEFAULT, "", "notalanguage"];
  for (const id of probes) {
    const bare = fimServesLanguage(id);
    assert.equal(fimServesLanguage(id, []), bare, `${id} with []`);
    assert.equal(fimServesLanguage(id, undefined), bare, `${id} with undefined`);
  }
});

// =========================================================================
// 5. Extras are human input, so they are forgiving
// =========================================================================

test("whitespace around an extra is trimmed", () => {
  for (const spelling of [" cpp", "cpp ", "  cpp  ", "\tcpp\t", "\ncpp\n"]) {
    assert.equal(
      fimServesLanguage("cpp", [spelling]),
      true,
      JSON.stringify(spelling),
    );
  }
});

test("case in an extra is folded", () => {
  for (const spelling of ["CPP", "Cpp", "cPp", "cPP"]) {
    assert.equal(
      fimServesLanguage("cpp", [spelling]),
      true,
      JSON.stringify(spelling),
    );
  }
});

test("case and whitespace fold together", () => {
  assert.equal(fimServesLanguage("cpp", ["  CpP  "]), true);
  assert.equal(fimServesLanguage("shellscript", ["\tShellScript "]), true);
});

test("a blank extra is ignored and never serves anything", () => {
  // The failure this bars: a settings list left with a trailing comma, or a
  // user who typed a newline, becoming a wildcard that serves every language.
  assert.equal(fimServesLanguage("", [""]), false);
  assert.equal(fimServesLanguage("markdown", ["", "  "]), false);
  assert.equal(fimServesLanguage("", ["   ", "\t", "\n"]), false);
  assert.equal(fimServesLanguage("plaintext", [""]), false);
  assert.equal(fimServesLanguage("notalanguage", ["", " "]), false);
});

test("a blank extra alongside a real one does not disturb the real one", () => {
  assert.equal(fimServesLanguage("cpp", ["", "cpp", "  "]), true);
  assert.equal(fimServesLanguage("markdown", ["", "cpp", "  "]), false);
});

test("the empty language id is never served, with or without extras", () => {
  for (const extra of [undefined, [], [""], ["  "], ["cpp"], ["rust"]]) {
    assert.equal(fimServesLanguage("", extra), false, JSON.stringify(extra));
  }
});

// =========================================================================
// 6. Purity: no state, no side effects, no way to widen from outside
// =========================================================================

test("repeated calls agree", () => {
  const probes = [...SHIPPED, ...NOT_SERVED_BY_DEFAULT, "", "cpp"];
  for (const id of probes) {
    const first = fimServesLanguage(id);
    for (let i = 0; i < 3; i++) {
      assert.equal(fimServesLanguage(id, ["cpp"]), fimServesLanguage(id, ["cpp"]), id);
      assert.equal(fimServesLanguage(id), first, id);
    }
  }
});

test("asking with extras does not change the answer without them", () => {
  // The cheap wrong implementation caches the widened set, or adds the extras
  // to FIM_LANGUAGES itself. Then one call with a setting widens the product
  // for every later caller, including the ones that passed nothing.
  assert.equal(fimServesLanguage("cpp"), false);
  assert.equal(fimServesLanguage("cpp", ["cpp"]), true);
  assert.equal(fimServesLanguage("cpp"), false, "the widening must not persist");
  assert.equal(FIM_LANGUAGES.has("cpp"), false, "the default set must not grow");
  assert.equal(FIM_LANGUAGES.size, SHIPPED.length);
});

test("the extras array handed in is not mutated", () => {
  const extra = ["  CPP ", "", "java"];
  const before = [...extra];
  fimServesLanguage("cpp", extra);
  fimServesLanguage("markdown", extra);
  assert.deepEqual(extra, before);
});

test("the default set survives every read-only probe this file made", () => {
  // Runs after every ordinary probe and before the two mutation probes below.
  // If asking a question widened or narrowed the set as a side effect, this is
  // where it shows up as one clear failure rather than as noise spread across
  // the file.
  assert.deepEqual(sorted(FIM_LANGUAGES), sorted(SHIPPED));
});

// The two probes below deliberately misbehave: they write to a ReadonlySet.
// What the contract pins is that a caller doing this cannot change what
// fimServesLanguage answers, not that the write is prevented. The set may be
// frozen, in which case the write throws in strict mode and the guarantee
// holds for the stronger reason. Both probes put the set back as they found
// it, so a mutable set does not leak into anything that runs after them.

test("a caller cannot widen the served set by adding to FIM_LANGUAGES", () => {
  let added = false;
  try {
    FIM_LANGUAGES.add("markdown");
    added = true;
  } catch {
    // frozen, which is the stronger form of the same guarantee
  }
  try {
    assert.equal(fimServesLanguage("markdown"), false);
  } finally {
    if (added) FIM_LANGUAGES.delete("markdown");
  }
});

test("a caller cannot narrow the served set by deleting from FIM_LANGUAGES", () => {
  let deleted = false;
  try {
    deleted = FIM_LANGUAGES.delete("rust") === true;
  } catch {
    // frozen, same guarantee
  }
  try {
    assert.equal(fimServesLanguage("rust"), true);
  } finally {
    if (deleted) FIM_LANGUAGES.add("rust");
  }
});

test("the answers are unchanged after the mutation probes", () => {
  // The property that matters is the predicate, not the set object. Restated
  // last so a mutation that DID stick shows up here as a serve-set failure.
  for (const id of SHIPPED) {
    assert.equal(fimServesLanguage(id), true, `${id} must still be served`);
  }
  for (const id of NOT_SERVED_BY_DEFAULT) {
    assert.equal(fimServesLanguage(id), false, `${id} must still not be served`);
  }
  assert.deepEqual(sorted(FIM_LANGUAGES), sorted(SHIPPED));
});
