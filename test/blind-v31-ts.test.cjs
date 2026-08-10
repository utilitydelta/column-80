// Blind oracle: the TypeScript TDD leg (session-v31/contract-ts.md, goal.md
// items 3 and 6, Amendments 1 and 2). Black-box contract tests written from the
// CONTRACT ALONE, before `src/core/tddTs.ts` exists. Covers:
//   §Registration   typescript + the three sibling languageIds, and the two
//                   languageIds that are still dark at this phase
//   §Placement      sibling foo.test.ts, the nearest package.json as runRoot,
//                   and the import line
//   §The extension trap  `bundler` gives `./foo`, `nodenext`/`node16` give
//                   `./foo.js` FROM A .ts FILE. The one thing that silently
//                   breaks a generated import.
//   §Framework      vitest before jest, and honest-dark naming BOTH
//   §The command    the local bin, `--reporter=json`, and the END-anchored `-t`
//                   filter as a REGEX PROPERTY
//   §The parse      titles, failures, counts, garbage tolerance, last-JSON-line
//   §The three no-run outcomes  filter miss versus unresolvable import, and the
//                   collision between them. The most important group here.
//   §returnTypeOf   the three a naive regex breaks
//   §Testability    async/io/needs-fixture/not-exported/underspecified, with
//                   Amendment 3 (Promise<void> is async, because predictable
//                   precedence is the property) and Amendment 4 (the METHOD
//                   FORM is the needs-fixture tell) carried
//   §expectedValueSpans  the SOLE ARGUMENT OF THE TERMINATING MATCHER, which is
//                   a shape no other language in this build has
//   §Blank values   bare versus hinted, in both directions (Amendment 2)
//   §Scaffold       vitest imports, the subject import, fenced markers, and
//                   generatedTestNames reading the `it` TITLE
//
// Never read src/**. The whole point of this file is independence from the
// implementation. Expected RED until phase 3 lands.
//
// Two guards, both collapsing a whole class of red into ONE loud failure:
//   1. a failed bundle (the module is missing) fails the bundle test and SKIPS
//      everything else.
//   2. `tddLangFor("typescript")` returning undefined (phase 3 not registered
//      yet) fails the registration test and SKIPS everything else.
// Neither produces a wall of TypeErrors.
//
// Run: SKIP_LIVE=1 node --test test/blind-v31-ts.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { bundleCore } = require("./.blind-util.cjs");

let mod = {};
let cleanup = () => {};
let bundleError;
try {
  ({ mod, cleanup } = bundleCore(
    "blind-v31-ts",
    `export { tddLangFor, frameworkFor } from "../src/core/tddLang";\n`
  ));
} catch (e) {
  bundleError = e;
}
// A FAILED bundle never returns a cleanup, and it still wrote the entry file.
// Sweep both paths so a red run leaves nothing behind in the tree.
test.after(() => {
  cleanup();
  for (const leftover of [".blind-v31-ts.entry.ts", ".blind-v31-ts.bundle.cjs"]) {
    fs.rmSync(path.join(__dirname, leftover), { force: true });
  }
});

const { tddLangFor, frameworkFor } = mod;

test("bundle: the seam surface builds and exports tddLangFor + frameworkFor [contract-seam.md 'New file: src/core/tddLang.ts']", () => {
  if (bundleError) {
    assert.fail(
      `bundle failed to build - the seam is not implemented yet: ${bundleError.message}`
    );
  }
  assert.strictEqual(typeof tddLangFor, "function", "tddLangFor is the one construction point");
  assert.strictEqual(typeof frameworkFor, "function", "frameworkFor resolves the rung");
});

// Resolve the TypeScript leg once. Its absence is the OTHER single loud failure.
let tsLang;
let legError;
if (!bundleError) {
  try {
    tsLang = tddLangFor("typescript");
  } catch (e) {
    legError = `tddLangFor("typescript") threw: ${e.message}`;
  }
  if (!legError && !tsLang) {
    legError =
      'tddLangFor("typescript") returned undefined: the phase 3 TypeScript leg is not registered yet';
  }
}

// Gated on the bundle only. Rows that must run even when the TS leg is absent.
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    return fn(ctx);
  });

// Gated on the bundle AND the registration. Everything else.
const ttest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleError) return ctx.skip("bundle failed to build; see the bundle test");
    if (legError) return ctx.skip("the TypeScript leg is not registered; see the REGISTRATION test");
    return fn(ctx);
  });

// ===========================================================================
// 1. Registration.
//    [contract-ts.md 'Registers "typescript" (and "typescriptreact",
//     "javascript", "javascriptreact") in tddLangFor']
// ===========================================================================

btest("REGISTRATION: tddLangFor('typescript') resolves a TddLang with markerPrefix '//' [contract-ts.md 'Registers \"typescript\" ... in `tddLangFor`'; '`markerPrefix` is `\"//\"`']", () => {
  assert.ok(!legError, legError || "");
  assert.strictEqual(typeof tsLang, "object", "a TddLang is an object of members, not a factory");
  assert.strictEqual(tsLang.languageId, "typescript", "the languageId round-trips the lookup key");
  assert.strictEqual(typeof tsLang.displayName, "string", "displayName is a string");
  assert.ok(
    /typescript/i.test(tsLang.displayName),
    `every refusal names the language, so displayName must say TypeScript, got ${JSON.stringify(tsLang.displayName)}`
  );
  assert.strictEqual(tsLang.markerPrefix, "//", "TypeScript comments the marker with //");
});

btest("REGISTRATION: typescriptreact, javascript and javascriptreact all resolve too - the leg is registered under four languageIds, not one [contract-ts.md 'Registers \"typescript\" (and \"typescriptreact\", \"javascript\", \"javascriptreact\")']", (ctx) => {
  if (legError) return ctx.skip("the TypeScript leg is not registered; see the REGISTRATION test");
  for (const id of ["typescriptreact", "javascript", "javascriptreact"]) {
    const lang = tddLangFor(id);
    assert.ok(
      lang,
      `tddLangFor(${JSON.stringify(id)}) must resolve, or the gesture refuses a .tsx or .js document the leg can plainly handle`
    );
    assert.strictEqual(lang.markerPrefix, "//", `${id}: the same marker prefix`);
    assert.deepStrictEqual(
      lang.frameworks.map((f) => f.id),
      tsLang.frameworks.map((f) => f.id),
      `${id}: the same frameworks in the same precedence order as typescript`
    );
  }
});

btest("REGISTRATION: frameworks are ['vitest', 'jest'] IN PRECEDENCE ORDER - the first whose detect fires wins [contract-seam.md 'Frameworks in PRECEDENCE order. The first whose detect fires wins'; contract-ts.md '1. vitest ... 2. jest']", (ctx) => {
  if (legError) return ctx.skip("the TypeScript leg is not registered; see the REGISTRATION test");
  assert.ok(Array.isArray(tsLang.frameworks), "frameworks is an array");
  assert.deepStrictEqual(
    tsLang.frameworks.map((f) => f.id),
    ["vitest", "jest"],
    `the order IS the precedence, and vitest is first because the measured corpus carries it. Got ${JSON.stringify(tsLang.frameworks.map((f) => f.id))}`
  );
  for (const fw of tsLang.frameworks) {
    assert.strictEqual(typeof fw.displayName, "string", `${fw.id}: displayName carries the honest-dark name`);
    assert.strictEqual(typeof fw.assertionInstruction, "string", `${fw.id}: the prompt fragment naming its assertion idiom`);
  }
});

btest("REGISTRATION: python and csharp BOTH resolve now that phases 4 and 5 have landed - the phased rollout is complete, there are no further flips due, and this row is now a regression pin that the neighbouring legs stay registered [contract-seam.md 'Go, TypeScript, Python and C# are phases 2 to 5, and tddLangFor returns undefined for them until their phase lands']", () => {
  for (const id of ["python", "csharp"]) {
    assert.ok(
      tddLangFor(id),
      `${id} was registered by its own phase, and every flip of this row was made deliberately when that phase shipped rather than discovered as a mystery red. A red here now is a leg that STOPPED resolving, which is a regression and not a schedule`
    );
  }
});

// ---------------------------------------------------------------------------
// Shared fixtures. No project on disk anywhere: deps.fileExists and
// deps.readFile are injected.
// ---------------------------------------------------------------------------

const ROOT = "/w/proj";
const PKG_JSON = path.join(ROOT, "package.json");
const TSCONFIG = path.join(ROOT, "tsconfig.json");

const SRC = path.join(ROOT, "src", "foo.ts");
const TARGET = path.join(ROOT, "src", "foo.test.ts");
const SYMBOL = "widen";

const ORPHAN = "/nowhere/loose.ts";

// A virtual filesystem. `files` exist with no readable text; `texts` exist AND
// read back.
const tsDeps = ({ files = [], texts = {} } = {}) => ({
  fileExists: (p) => files.includes(p) || Object.prototype.hasOwnProperty.call(texts, p),
  readFile: (p) => texts[p],
  readDir: () => undefined,
  log: () => {},
});

// The measured corpus shape: vitest in devDependencies with a `test` script.
const PKG_VITEST = JSON.stringify({
  name: "probe",
  devDependencies: { vitest: "^4.1.7", typescript: "^5.6.0" },
  scripts: { test: "vitest run" },
});
const PKG_JEST = JSON.stringify({
  name: "probe",
  devDependencies: { jest: "^29.7.0", typescript: "^5.6.0" },
  scripts: { test: "jest" },
});
const PKG_BOTH = JSON.stringify({
  name: "probe",
  devDependencies: { jest: "^29.7.0", vitest: "^4.1.7" },
});
const PKG_NEITHER = JSON.stringify({
  name: "probe",
  devDependencies: { typescript: "^5.6.0", eslint: "^9.0.0" },
});

// `bundler` is what react-mobx-mvvm actually sets. The other two are the trap.
const TSCONFIG_BUNDLER = JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } });
const TSCONFIG_NODENEXT = JSON.stringify({
  compilerOptions: { module: "nodenext", moduleResolution: "nodenext" },
});
const TSCONFIG_NODE16 = JSON.stringify({
  compilerOptions: { module: "node16", moduleResolution: "node16" },
});

// The ordinary case: a package.json at the project root, a bundler tsconfig,
// the source file, no sibling test file yet.
const DEPS = tsDeps({
  files: [SRC],
  texts: { [PKG_JSON]: PKG_VITEST, [TSCONFIG]: TSCONFIG_BUNDLER },
});
// Same, but foo.test.ts is already on disk.
const DEPS_TARGET_EXISTS = tsDeps({
  files: [SRC, TARGET],
  texts: { [PKG_JSON]: PKG_VITEST, [TSCONFIG]: TSCONFIG_BUNDLER },
});
// No tsconfig at all: moduleResolution cannot be determined.
const DEPS_NO_TSCONFIG = tsDeps({ files: [SRC], texts: { [PKG_JSON]: PKG_VITEST } });
const DEPS_NODENEXT = tsDeps({
  files: [SRC],
  texts: { [PKG_JSON]: PKG_VITEST, [TSCONFIG]: TSCONFIG_NODENEXT },
});
const DEPS_NODE16 = tsDeps({
  files: [SRC],
  texts: { [PKG_JSON]: PKG_VITEST, [TSCONFIG]: TSCONFIG_NODE16 },
});
// Nothing exists: no package.json can be found.
const DEPS_NO_PKG = tsDeps({});

const DEPS_JEST_ONLY = tsDeps({ files: [SRC], texts: { [PKG_JSON]: PKG_JEST, [TSCONFIG]: TSCONFIG_BUNDLER } });
const DEPS_BOTH_FRAMEWORKS = tsDeps({ files: [SRC], texts: { [PKG_JSON]: PKG_BOTH, [TSCONFIG]: TSCONFIG_BUNDLER } });
const DEPS_NO_FRAMEWORK = tsDeps({ files: [SRC], texts: { [PKG_JSON]: PKG_NEITHER, [TSCONFIG]: TSCONFIG_BUNDLER } });

const placeOk = (filePath, symbol, deps) => {
  const res = tsLang.placementFor(filePath, symbol, deps);
  assert.strictEqual(
    res.ok,
    true,
    `expected a placement for ${filePath}, got refusal ${JSON.stringify(res.refusal)}`
  );
  return res.placement;
};

// The module specifier out of an import line, whatever quote style it uses.
const specifierOf = (importLine) => {
  assert.strictEqual(typeof importLine, "string", "importLine is a string");
  const m = /from\s+['"]([^'"]+)['"]/.exec(importLine);
  assert.ok(m, `the import line carries a module specifier, got ${JSON.stringify(importLine)}`);
  return m[1];
};

// A duck-typed placement, so the command pins depend on buildCommand alone.
const tsPlacement = (over = {}) => ({
  targetPath: TARGET,
  exists: false,
  mode: "sibling-file",
  runRoot: ROOT,
  packageArg: undefined,
  importLine: "import { widen } from './foo';",
  ...over,
});

const vitestFw = () => {
  const fw = tsLang.frameworks.find((f) => f.id === "vitest");
  assert.ok(fw, `a vitest framework entry exists, got ${JSON.stringify(tsLang.frameworks.map((f) => f.id))}`);
  return fw;
};

// `-t` may ride as two args or as `-t=<pattern>`, and vitest also spells it
// `--testNamePattern`. All three are the same filter, so extract rather than
// pinning one encoding.
const tPatternOf = (cmd) => {
  const i = cmd.args.findIndex(
    (a) => a === "-t" || a.startsWith("-t=") || a === "--testNamePattern" || a.startsWith("--testNamePattern=")
  );
  assert.ok(i >= 0, `the command carries a -t filter, got ${JSON.stringify(cmd.args)}`);
  const arg = cmd.args[i];
  const raw = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : cmd.args[i + 1];
  assert.strictEqual(typeof raw, "string", "-t is followed by its pattern");
  return raw;
};

// Apply a TestInsertionPlan so the assertions read the RESULTING document,
// whether the plan carries the whole file or only the appended region.
const applyPlan = (existingText, plan) =>
  existingText.slice(0, plan.start) + plan.text + existingText.slice(plan.end);

// ===========================================================================
// 2. Placement. Sibling file, nearest package.json, no package argument.
//    [contract-ts.md '## Placement']
// ===========================================================================

ttest("placementFor ts: <root>/src/foo.ts places tests in <root>/src/foo.test.ts, mode 'sibling-file', runRoot the nearest package.json directory, packageArg undefined [contract-ts.md '`sibling-file`. For `<dir>/foo.ts` the tests go in `<dir>/foo.test.ts`'; '`runRoot` is the nearest ancestor directory holding a `package.json`'; '`packageArg` is undefined']", () => {
  const p = placeOk(SRC, SYMBOL, DEPS);
  assert.strictEqual(p.targetPath, TARGET, "the target is the .test.ts sibling, not the source file");
  assert.strictEqual(p.mode, "sibling-file", "TypeScript's tests are a sibling, unlike Rust's same-file module");
  assert.strictEqual(p.runRoot, ROOT, "vitest runs from the package root, not the source directory");
  assert.strictEqual(
    p.packageArg,
    undefined,
    `vitest takes the test FILE path, which comes from targetPath, so there is no package argument to get wrong. Got ${JSON.stringify(p.packageArg)}`
  );
});

ttest("placementFor ts: importLine is REQUIRED and names the symbol - TypeScript reaches the unit through an import, which is why this leg has a visibility refusal Rust and Go do not [contract-ts.md '`importLine` is required, and this is where TypeScript differs from Rust and Go: the test reaches the unit through an import']", () => {
  const p = placeOk(SRC, SYMBOL, DEPS);
  assert.strictEqual(typeof p.importLine, "string", "the sibling test file cannot see the unit without an import");
  assert.ok(/^\s*import\b/.test(p.importLine), `the line is an import statement, got ${JSON.stringify(p.importLine)}`);
  assert.ok(
    p.importLine.includes(SYMBOL),
    `the import names the symbol under test, got ${JSON.stringify(p.importLine)}`
  );
  assert.strictEqual(
    specifierOf(p.importLine),
    "./foo",
    `the sibling sits in the same directory, so the specifier is always ./<basename> with no path arithmetic. Got ${JSON.stringify(p.importLine)}`
  );
});

ttest("placementFor ts: `exists` tracks whether foo.test.ts is already on disk [contract-seam.md 'True when targetPath already exists on disk']", () => {
  assert.strictEqual(
    placeOk(SRC, SYMBOL, DEPS).exists,
    false,
    "no sibling test file yet, so the gesture is creating one and the third write path applies"
  );
  assert.strictEqual(
    placeOk(SRC, SYMBOL, DEPS_TARGET_EXISTS).exists,
    true,
    "the sibling exists, so the gesture is extending it"
  );
});

ttest("placementFor ts: a file with NO package.json above it refuses with reason 'no-project-root' and a detail NAMING package.json [contract-ts.md 'No `package.json` means refuse with `no-project-root` naming it'; contract-seam.md 'it must NAME WHAT IS MISSING']", () => {
  const res = tsLang.placementFor(ORPHAN, SYMBOL, DEPS_NO_PKG);
  assert.strictEqual(res.ok, false, "no project root means the gesture cannot place a test");
  assert.strictEqual(res.refusal.reason, "no-project-root", "the enumerated reason, not free text");
  assert.ok(
    res.refusal.detail.includes("package.json"),
    `the detail names the missing thing by name, got ${JSON.stringify(res.refusal.detail)}`
  );
  assert.strictEqual(res.placement, undefined, "a refusal never smuggles a half-built placement through");
});

// ===========================================================================
// 3. THE IMPORT EXTENSION TRAP. The one thing that silently breaks a generated
//    import, and the only way to see it is to inject a tsconfig.
//    [contract-ts.md '### The import line, and the one thing that can silently
//     break it']
// ===========================================================================

ttest("EXTENSION TRAP: moduleResolution 'bundler', which is what the real corpus sets, gives the EXTENSIONLESS specifier './foo' [contract-ts.md 'Its `tsconfig.app.json` sets \"moduleResolution\": \"bundler\"'; 'Extensionless is correct for `bundler`, `node`, `node10` and `classic`']", () => {
  const p = placeOk(SRC, SYMBOL, DEPS);
  const spec = specifierOf(p.importLine);
  assert.strictEqual(spec, "./foo", `bundler resolution wants no extension, got ${JSON.stringify(spec)}`);
  assert.ok(
    !spec.endsWith(".js"),
    `adding .js under bundler resolution produces an import that does not resolve, and vitest reports it as "Cannot find module" rather than as anything the human can act on. Got ${JSON.stringify(spec)}`
  );
  assert.ok(!spec.endsWith(".ts"), `never the .ts extension either, got ${JSON.stringify(spec)}`);
});

ttest("EXTENSION TRAP: moduleResolution 'nodenext' and 'node16' require the EMITTED extension './foo.js', EVEN FROM A .ts FILE - this is the silent breakage the contract singles out [contract-ts.md 'It is WRONG for `node16` and `nodenext`, which require the emitted extension (`./Logger.js`, even from a `.ts` file)']", () => {
  for (const [label, deps] of [
    ["nodenext", DEPS_NODENEXT],
    ["node16", DEPS_NODE16],
  ]) {
    const p = placeOk(SRC, SYMBOL, deps);
    const spec = specifierOf(p.importLine);
    assert.strictEqual(
      spec,
      "./foo.js",
      `${label}: the specifier carries the EMITTED extension, not the source one and not none at all. Got ${JSON.stringify(spec)} from ${JSON.stringify(p.importLine)}`
    );
    assert.ok(
      !spec.endsWith(".ts.js") && !spec.endsWith(".ts"),
      `${label}: the source extension is replaced, not appended to. Got ${JSON.stringify(spec)}`
    );
  }
});

ttest("EXTENSION TRAP: with NO tsconfig at all the specifier PREFERS EXTENSIONLESS rather than guessing, and the leg is expected to say so on the evidence channel [contract-ts.md 'When `moduleResolution` cannot be determined, prefer extensionless and SAY so on the evidence channel rather than guessing silently']", () => {
  const p = placeOk(SRC, SYMBOL, DEPS_NO_TSCONFIG);
  assert.strictEqual(
    specifierOf(p.importLine),
    "./foo",
    `undetermined resolution falls back to extensionless, which is right for four of the six modes. Got ${JSON.stringify(p.importLine)}`
  );
});

// ===========================================================================
// 4. Framework detection. vitest before jest, and honest-dark naming BOTH.
//    [contract-ts.md '## Framework detection']
// ===========================================================================

ttest("frameworkFor ts: vitest wins when `vitest` is in devDependencies [contract-ts.md '1. vitest: `vitest` in `dependencies` or `devDependencies`. PROVEN present in `react-mobx-mvvm`']", () => {
  const res = frameworkFor(tsLang, ROOT, DEPS);
  assert.strictEqual(res.ok, true, `vitest is declared, so the rung resolves. Got ${JSON.stringify(res)}`);
  assert.strictEqual(res.framework.id, "vitest", "the resolved framework is vitest");
  assert.strictEqual(vitestFw().detect(ROOT, DEPS), true, "detect is pure over the injected deps: no project on disk needed");
});

ttest("frameworkFor ts: jest wins when ONLY `jest` is declared, and vitest's detect must return false there [contract-ts.md '2. jest: `jest` in either dependency map']", () => {
  const res = frameworkFor(tsLang, ROOT, DEPS_JEST_ONLY);
  assert.strictEqual(res.ok, true, `jest is declared, so the rung resolves. Got ${JSON.stringify(res)}`);
  assert.strictEqual(res.framework.id, "jest", "the resolved framework is jest");
  assert.strictEqual(
    vitestFw().detect(ROOT, DEPS_JEST_ONLY),
    false,
    "vitest is not in this project, so its detect must not fire; a framework that detects itself everywhere makes the precedence list meaningless"
  );
});

ttest("frameworkFor ts: with BOTH declared, PRECEDENCE decides and vitest wins [contract-seam.md 'Frameworks in PRECEDENCE order. The first whose detect fires wins']", () => {
  const res = frameworkFor(tsLang, ROOT, DEPS_BOTH_FRAMEWORKS);
  assert.strictEqual(res.ok, true, "both declared, so something resolves");
  assert.strictEqual(
    res.framework.id,
    "vitest",
    `precedence is the list order and vitest is first, so a project carrying both gets vitest deterministically rather than by whichever detect happened to run. Got ${JSON.stringify(res.framework.id)}`
  );
});

ttest("frameworkFor ts: NEITHER present is honest-dark - ok:false with lookedFor naming BOTH frameworks, and nothing is ever installed or assumed [contract-ts.md 'Neither found is honest-dark: refuse and NAME BOTH frameworks that were looked for. Never install one, never write a config'; goal.md 'Never install a framework, never write a config']", () => {
  const res = frameworkFor(tsLang, ROOT, DEPS_NO_FRAMEWORK);
  assert.strictEqual(
    res.ok,
    false,
    `no configured framework means the gesture goes dark. Assuming vitest here would generate tests against a runner the project does not have. Got ${JSON.stringify(res)}`
  );
  assert.strictEqual(res.framework, undefined, "a refusal never smuggles a guessed framework through");
  assert.ok(Array.isArray(res.lookedFor), `lookedFor is an array, got ${JSON.stringify(res.lookedFor)}`);
  const named = res.lookedFor.join(" ");
  assert.ok(/vitest/i.test(named), `the message names vitest, got ${JSON.stringify(res.lookedFor)}`);
  assert.ok(/jest/i.test(named), `the message names jest, got ${JSON.stringify(res.lookedFor)}`);

  for (const fw of tsLang.frameworks) {
    assert.strictEqual(
      fw.detect(ROOT, DEPS_NO_FRAMEWORK),
      false,
      `${fw.id}: a project declaring neither must detect neither, or the honest-dark path is unreachable`
    );
  }
});

// ===========================================================================
// 5. The command. THE SAFETY PIN, and the anchoring is the opposite of Go's.
//    [contract-ts.md '## The command']
// ===========================================================================

ttest("vitest.buildCommand: the LOCAL binary at <runRoot>/node_modules/.bin/vitest, cwd the runRoot, args carrying `run`, the target FILE path and --reporter=json - npx is banned because it prints npm warnings onto stdout ahead of the JSON [contract-ts.md 'Use the LOCAL binary, not `npx`'; 'Measured: invoking `node_modules/.bin/vitest` directly gives clean JSON with no preamble']", () => {
  const cmd = vitestFw().buildCommand(tsPlacement(), ["nameA", "nameB"]);
  assert.strictEqual(typeof cmd.command, "string", "command is a string");
  const asPosix = cmd.command.replace(/\\/g, "/");
  assert.ok(
    asPosix.endsWith("node_modules/.bin/vitest"),
    `the command is the project's own vitest binary, got ${JSON.stringify(cmd.command)}`
  );
  assert.ok(
    !/\bnpx\b/.test(cmd.command) && !cmd.args.some((a) => /\bnpx\b/.test(a)),
    `npx can resolve from the network AND prefixes stdout with npm warnings, which breaks the JSON parse. Got ${JSON.stringify([cmd.command, ...cmd.args])}`
  );
  assert.strictEqual(cmd.cwd, ROOT, "cwd is the placement's runRoot, which for TypeScript is the package root");

  assert.ok(Array.isArray(cmd.args), "args is an array, not a shell string");
  assert.ok(
    cmd.args.includes("run"),
    `the run subcommand is mandatory or vitest watches forever, got ${JSON.stringify(cmd.args)}`
  );
  assert.ok(
    cmd.args.includes(TARGET),
    `the test FILE path rides through from the placement, because vitest takes a file and not a package. Got ${JSON.stringify(cmd.args)}`
  );
  assert.ok(
    cmd.args.includes("--reporter=json"),
    `--reporter=json is what the whole parse binds to; the default human reporter has no per-case structure. Got ${JSON.stringify(cmd.args)}`
  );
});

ttest("vitest.buildCommand: the -t filter is END-anchored with `$` and is NOT start-anchored with `^`, because -t sees the DESCRIBE-JOINED FULL NAME and `^` therefore matches nothing [contract-ts.md 'End-anchor with `$`, never start-anchor with `^`. `-t` matches the FULL name, which is the describe titles and the test title joined by spaces, so `^(a|b)$` matches NOTHING while `(a|b)$` selects exactly the two. This was measured both ways']", () => {
  const cmd = vitestFw().buildCommand(tsPlacement(), ["nameA", "nameB"]);
  const pattern = tPatternOf(cmd);

  assert.ok(pattern.includes("$"), `the filter is end-anchored, got ${JSON.stringify(pattern)}`);
  assert.ok(
    !pattern.includes("^"),
    `a start anchor matches NOTHING, because -t is applied to "<describe titles> <test title>" and the generated title never begins the string. A ^-anchored filter selects zero tests, exits 0, and reads as a pass. Got ${JSON.stringify(pattern)}`
  );
  assert.ok(pattern.includes("nameA"), "the first name is in the filter");
  assert.ok(pattern.includes("nameB"), "the second name is in the filter");
  assert.ok(
    !pattern.includes("'"),
    `the pattern is a spawn argument, not a shell word: shell quotes inside it would be matched literally. Got ${JSON.stringify(pattern)}`
  );
});

ttest("vitest.buildCommand: the anchoring is a PROPERTY OF THE EMITTED REGEX - the describe-prefixed full name matches, and a SUPERSET title does not [contract-ts.md '`-t` IS a regex, and alternation selects exactly the named tests'; 'End-anchor with `$`']", () => {
  const cmd = vitestFw().buildCommand(tsPlacement(), ["nameA", "nameB"]);
  const re = new RegExp(tPatternOf(cmd));

  assert.strictEqual(
    re.test("describe prefix nameA"),
    true,
    "the describe-joined full name is what -t is matched against, and the named test must be selected through it"
  );
  assert.strictEqual(re.test("describe prefix nameB"), true, "the second name is selected through its prefix too");
  assert.strictEqual(
    re.test("describe prefix nameAExtra"),
    false,
    "a superset title must NOT be selected: an unanchored filter silently runs tests the human never asked for, and their result is reported as this function's"
  );
  assert.strictEqual(re.test("describe prefix nameC"), false, "an unrelated title is not selected");
});

ttest("vitest.buildCommand: an empty testNames array must NEVER emit `-t \"()$\"` - an empty alternation selects nothing, exits 0 and reads as a pass [contract-ts.md 'An empty `testNames` array must never produce `-t \"()$\"`. Refuse upstream']", () => {
  let cmd;
  try {
    cmd = vitestFw().buildCommand(tsPlacement(), []);
  } catch (e) {
    // Throwing is a legitimate refusal. Nothing further to check.
    assert.ok(e instanceof Error, "a refusal by throw is an Error");
    return;
  }
  const joined = cmd.args.join(" ");
  assert.ok(
    !joined.includes("()$"),
    `an empty-alternation filter matches every name and selects nothing useful, which is exactly the false green this design guards against. Got ${JSON.stringify(cmd.args)}`
  );
});

// ---------------------------------------------------------------------------
// Runner fixtures. Every one is DERIVED from the shapes recorded in
// contract-ts.md ("## The parse: `--reporter=json`" and "## The three no-run
// outcomes"), not captured by running vitest here. The FIELDS and their VALUES
// are the contract's measurements; the titles and paths around them are made up
// to make the assertions readable.
// ---------------------------------------------------------------------------

const TEST_FILE = TARGET;

// DERIVED from the contract's shape block: one failure, one pass, one skip.
const VITEST_MIXED_DOC = {
  numTotalTests: 3,
  numPassedTests: 1,
  numFailedTests: 1,
  numPendingTests: 1,
  success: false,
  testResults: [
    {
      name: TEST_FILE,
      status: "failed",
      message: "",
      assertionResults: [
        {
          title: "doubles its argument",
          fullName: "widen doubles its argument",
          ancestorTitles: ["widen"],
          status: "failed",
          failureMessages: ["AssertionError: expected 6 to be 7 // Object.is equality"],
        },
        {
          title: "returns zero for zero",
          fullName: "widen returns zero for zero",
          ancestorTitles: ["widen"],
          status: "passed",
          failureMessages: [],
        },
        {
          title: "handles negatives",
          fullName: "widen handles negatives",
          ancestorTitles: ["widen"],
          status: "skipped",
          failureMessages: [],
        },
      ],
    },
  ],
};
const VITEST_MIXED = JSON.stringify(VITEST_MIXED_DOC) + "\n";

// DERIVED: the same document behind a non-JSON preamble line AND behind an
// earlier, DIFFERENT JSON document. Pins "the LAST line that parses as JSON
// wins" rather than "the first" or "the whole of stdout".
const VITEST_WITH_PREAMBLE =
  "npm warn exec The following package was not found and will be installed: vitest\n" +
  JSON.stringify({ ...VITEST_MIXED_DOC, numPassedTests: 99, numFailedTests: 0, testResults: [] }) +
  "\n" +
  JSON.stringify(VITEST_MIXED_DOC) +
  "\n";

// THE FILTER MISS, the contract's measured counts. Exit 0, success true, every
// assertionResult skipped. vitest has NO positive text tell for this.
const VITEST_FILTER_MISS = JSON.stringify({
  numTotalTests: 4,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 4,
  success: true,
  testResults: [
    {
      name: TEST_FILE,
      status: "passed",
      message: "",
      assertionResults: ["a", "b", "c", "d"].map((t) => ({
        title: `case ${t}`,
        fullName: `suite case ${t}`,
        ancestorTitles: ["suite"],
        status: "skipped",
        failureMessages: [],
      })),
    },
  ],
});

// THE UNRESOLVABLE IMPORT, the contract's measured shape. Exit 1, success
// false, EVERY count zero including numPendingTests, an EMPTY assertionResults
// array and a populated `message`. stderr is EMPTY, which is the point.
const VITEST_BAD_IMPORT = JSON.stringify({
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  success: false,
  testResults: [
    {
      name: TEST_FILE,
      status: "failed",
      message:
        "Error: Cannot find module './widen' imported from '/w/proj/src/foo.test.ts'",
      assertionResults: [],
    },
  ],
});
const VITEST_BAD_IMPORT_STDERR = "";

// ===========================================================================
// 6. The parse. Titles, failures, counts, garbage tolerance.
//    [contract-ts.md '## The parse: `--reporter=json`']
// ===========================================================================

ttest("vitest.parseOutput: cases come from assertionResults and are named by TITLE, not fullName - the marker region and the -t filter both deal in the title [contract-ts.md '`cases`: one per `assertionResults` entry. Use `title` as the name, since that is what the marker region and the `-t` filter deal in; `fullName` carries the describe prefix']", () => {
  const p = vitestFw().parseOutput(VITEST_MIXED, "", 1);
  const names = p.cases.map((c) => c.name);
  assert.strictEqual(p.cases.length, 3, `three assertionResults, three cases, got ${JSON.stringify(p.cases)}`);
  assert.ok(
    names.includes("doubles its argument"),
    `the case is named by its title, got ${JSON.stringify(names)}`
  );
  assert.ok(
    !names.includes("widen doubles its argument"),
    `fullName carries the describe prefix and would not match anything the scaffold wrote or the filter selects. Got ${JSON.stringify(names)}`
  );

  const byName = Object.fromEntries(p.cases.map((c) => [c.name, c.outcome]));
  assert.strictEqual(byName["doubles its argument"], "fail", "a failed assertionResult is a failing case");
  assert.strictEqual(byName["returns zero for zero"], "pass", "a passed assertionResult is a passing case");
});

ttest("vitest.parseOutput: failures come from failureMessages, counts from numPassedTests/numFailedTests/numPendingTests, casesComplete is true and ran is true [contract-ts.md '`failures`: entries with `status: \"failed\"`, message from `failureMessages`'; 'counts from `numPassedTests` / `numFailedTests` / `numPendingTests`'; '`casesComplete: true`. vitest enumerates passing tests, unlike C#'; '`ran`: at least one `assertionResults` entry exists']", () => {
  const p = vitestFw().parseOutput(VITEST_MIXED, "", 1);
  assert.strictEqual(p.passed, 1, `numPassedTests is the source of truth for passed, got ${p.passed}`);
  assert.strictEqual(p.failed, 1, `numFailedTests is the source of truth for failed, got ${p.failed}`);
  assert.strictEqual(p.ignored, 1, `numPendingTests is the source of truth for ignored, got ${p.ignored}`);
  assert.strictEqual(p.ran, true, "assertionResults entries exist, so tests ran");
  assert.strictEqual(
    p.casesComplete,
    true,
    "vitest enumerates passing tests, so consumers may render `cases` as the full run"
  );

  assert.strictEqual(p.failures.length, 1, `one failing test, one detail, got ${JSON.stringify(p.failures)}`);
  const f = p.failures[0];
  assert.strictEqual(f.name, "doubles its argument", "the failure is named by the same title as its case");
  assert.ok(
    f.message.includes("expected 6 to be 7"),
    `the failureMessages entry is the detail the human reads, got ${JSON.stringify(f.message)}`
  );
  assert.ok(p.filterMatchedNothing !== true, "a run that executed two tests is not a filter miss");
});

ttest("vitest.parseOutput: a PREAMBLE line before the JSON does not break the parse, and the LAST JSON-parsing line wins rather than the first [contract-ts.md 'Parse defensively: take the LAST line of stdout that parses as JSON, so a stray banner never breaks the rung even though the local binary emits none today']", () => {
  const p = vitestFw().parseOutput(VITEST_WITH_PREAMBLE, "", 1);
  assert.strictEqual(
    p.passed,
    1,
    `an npm banner ahead of the JSON must not defeat the parse, and an EARLIER json document must not win over the last one. Got passed=${p.passed}`
  );
  assert.notStrictEqual(
    p.passed,
    99,
    "taking the FIRST parsing line reports a run that never happened as 99 passing tests"
  );
  assert.strictEqual(p.failed, 1, "the real document's failure count survives");
  assert.strictEqual(p.cases.length, 3, `the real document's cases survive, got ${JSON.stringify(p.cases)}`);
});

ttest("vitest.parseOutput: garbage, empty input and a truncated document give a did-not-run result and NEVER throw [contract-ts.md 'Parse defensively'; contract-seam.md 'ran: boolean']", () => {
  const fw = vitestFw();
  for (const [label, out, err, exit] of [
    ["empty", "", "", 0],
    ["non-json noise", "some tool said something weird\n{not json}\n", "", 1],
    ["arbitrary bytes", " ￿\n\n\t garbage", "", 1],
    ["stderr only", "", "vitest: command not found\n", 127],
    ["a truncated json document", '{"numPassedTests":1,"testResults":[', "", 1],
    ["json that is not an object", "[1,2,3]", "", 1],
  ]) {
    let p;
    assert.doesNotThrow(() => {
      p = fw.parseOutput(out, err, exit);
    }, `${label}: parseOutput never throws`);
    assert.strictEqual(p.ran, false, `${label}: no assertionResults means nothing ran`);
    assert.strictEqual(p.passed, 0, `${label}: zero passed`);
    assert.strictEqual(p.failed, 0, `${label}: zero failed`);
    assert.deepStrictEqual(p.cases, [], `${label}: no fabricated cases`);
    assert.strictEqual(typeof p.casesComplete, "boolean", `${label}: casesComplete is always present`);
  }
});

// ===========================================================================
// 7. THE THREE NO-RUN OUTCOMES, and the collision between two of them. The most
//    important group in this file.
//    [contract-ts.md '## The three no-run outcomes, all measured, and two of
//     them collide'; contract-seam.md '### The three no-run outcomes are
//     DIFFERENT, and telling them apart is the point']
// ===========================================================================

ttest("NO-RUN 1, FILTER MISS: exit 0, success true, 4 pending and every assertionResult skipped sets filterMatchedNothing=true with both counts 0 and NO environmentError - vitest has no positive text tell, so a zero exit and the word 'skipped' look exactly like a pass [contract-ts.md 'Derive it: `filterMatchedNothing` is `numPassedTests + numFailedTests === 0` AND `numPendingTests > 0` AND `success === true`']", () => {
  const p = vitestFw().parseOutput(VITEST_FILTER_MISS, "", 0);

  assert.strictEqual(p.passed, 0, `nothing passed, got ${p.passed}`);
  assert.strictEqual(p.failed, 0, "nothing failed either, because nothing executed");
  assert.strictEqual(p.passed + p.failed, 0, "executed is zero, so green must never be claimed");
  assert.strictEqual(
    p.filterMatchedNothing,
    true,
    `the human must read "the filter matched nothing" rather than a bare refusal or, worse, a pass. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
  assert.strictEqual(
    p.environmentError,
    undefined,
    `the run was FINE; the names did not match. Setting environmentError here sends the human hunting a broken toolchain that works. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.strictEqual(p.ignored, 4, `numPendingTests rides through as ignored, got ${p.ignored}`);
  assert.strictEqual(
    p.ran,
    true,
    "`ran` answers 'did the runner produce test results', and four skipped assertionResults are results. It is true here and FALSE for a Go filter miss, and that asymmetry is deliberate. What stops this reading green is the `executed > 0` guard plus filterMatchedNothing, never `ran`. Redefining `ran` to mean 'something executed' is a seam change that breaks Rust"
  );
});

ttest("NO-RUN 2, UNRESOLVABLE IMPORT: exit 1, success false, EVERY count zero, an EMPTY assertionResults with a populated message and an EMPTY stderr sets environmentError REACHABLE BY NAME, and NOT filterMatchedNothing [contract-ts.md 'Set `environmentError` from `testResults[].message`'; contract-seam.md 'the environment could not start the run ... environmentError']", () => {
  const p = vitestFw().parseOutput(VITEST_BAD_IMPORT, VITEST_BAD_IMPORT_STDERR, 1);
  assert.strictEqual(VITEST_BAD_IMPORT_STDERR, "", "the fixture's stderr really is empty, which is the point of this row");

  assert.strictEqual(
    typeof p.environmentError,
    "string",
    `without environmentError this lands as "the tests did not compile" while stderr is empty, so the human is told to fix a compile error and shown no message at all. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.ok(
    p.environmentError.includes("Cannot find module"),
    `the runner's own diagnosis must survive into the parse, because it names the specifier that did not resolve. Got ${JSON.stringify(p.environmentError)}`
  );
  assert.strictEqual(p.passed, 0, "nothing passed");
  assert.strictEqual(p.failed, 0, "an unresolvable import is not a test failure");
  assert.strictEqual(p.ignored, 0, "numPendingTests is zero here, and that zero is the discriminator");
  assert.deepStrictEqual(p.cases, [], "assertionResults is empty, so no fabricated cases");
  assert.strictEqual(p.ran, false, "no assertionResults entry exists, so nothing ran");
  assert.ok(
    p.filterMatchedNothing !== true,
    `an unresolvable import is not a filter miss. Got ${JSON.stringify(p.filterMatchedNothing)}`
  );
});

ttest("THE COLLISION: a filter miss and an unresolvable import BOTH have zero passed and zero failed, and `numPendingTests > 0` is the discriminator. Without it a broken import is reported as 'your filter matched nothing', which is the same trap Go had [contract-ts.md 'This is the collision: the counts are 0 and 0 here just as they are in a filter miss ... Requiring `numPendingTests > 0` for the filter miss is what keeps a broken import from being reported as \"your filter matched nothing\"']", () => {
  const fw = vitestFw();
  const miss = fw.parseOutput(VITEST_FILTER_MISS, "", 0);
  const broken = fw.parseOutput(VITEST_BAD_IMPORT, VITEST_BAD_IMPORT_STDERR, 1);

  // The two runs are indistinguishable on the counts a naive rule reads.
  assert.strictEqual(miss.passed + miss.failed, 0, "filter miss: zero executed");
  assert.strictEqual(broken.passed + broken.failed, 0, "unresolvable import: zero executed, identically");

  // And they must still land in DIFFERENT fields.
  assert.strictEqual(miss.filterMatchedNothing, true, "only the filter miss is a filter miss");
  assert.ok(
    broken.filterMatchedNothing !== true,
    `numPendingTests is 4 for the miss and 0 here, which is the whole discriminator. A rule that reads only "passed + failed === 0" sends a human with a broken import to edit a filter that was never the problem. Got ${JSON.stringify(broken.filterMatchedNothing)}`
  );
  assert.strictEqual(
    typeof broken.environmentError,
    "string",
    "only the broken import is an environment error"
  );
  assert.strictEqual(miss.environmentError, undefined, "the filter miss carries no environment error");
});

ttest("NO-RUN 3 DOES NOT EXIST: `buildError` is NEVER set by this leg, because vitest does not type-check. A generated test with a type error surfaces as a RED that looks like a wrong expected value [contract-ts.md 'There is NO compile outcome, and this is the surprise. Measured: vitest does not type-check ... So `buildError` is never set by this leg']", () => {
  const fw = vitestFw();
  for (const [label, out, err, exit] of [
    ["a mixed run", VITEST_MIXED, "", 1],
    ["a filter miss", VITEST_FILTER_MISS, "", 0],
    ["an unresolvable import", VITEST_BAD_IMPORT, VITEST_BAD_IMPORT_STDERR, 1],
    ["a preamble run", VITEST_WITH_PREAMBLE, "", 1],
    ["garbage", "not json at all", "", 1],
  ]) {
    const p = fw.parseOutput(out, err, exit);
    assert.strictEqual(
      p.buildError,
      undefined,
      `${label}: vitest never reports a compile error because it never compiles. Setting buildError here invents an outcome the runner cannot produce. Got ${JSON.stringify(p.buildError)}`
    );
  }
});

// ===========================================================================
// 8. returnTypeOf. The shipped `->` regex returns undefined for every
//    TypeScript function.
//    [contract-ts.md '## `returnTypeOf`']
// ===========================================================================

ttest("returnTypeOf ts: the contract's table, row for row [contract-ts.md '## `returnTypeOf`' table]", () => {
  const table = [
    ["function f(a: number): number {", "number"],
    ["export const g = (a: number): string =>", "string"],
    ["function h(a: number)", undefined],
    ["async function i(): Promise<number>", "Promise<number>"],
    ["function j(cb: (x: number) => number): string", "string"],
    ["method(a: number): boolean {", "boolean"],
    ["function k(a: {x: number}): number", "number"],
  ];
  for (const [sig, want] of table) {
    assert.strictEqual(
      tsLang.returnTypeOf(sig),
      want,
      `${JSON.stringify(sig)} yields ${JSON.stringify(want)}`
    );
  }
});

ttest("returnTypeOf ts: THE THREE A NAIVE REGEX BREAKS - a function-typed parameter carries its own `=>` and colon, an object-type parameter carries a colon and braces, and an arrow function's `=>` is not the return marker. All three need the parameter list's MATCHING close paren [contract-ts.md 'The last three are what a naive regex breaks on ... Depth-count to the parameter list's matching close paren']", () => {
  assert.strictEqual(
    tsLang.returnTypeOf("function j(cb: (x: number) => number): string"),
    "string",
    "a function-typed parameter nests a `)` and a `=>` INSIDE the parameter list; the first `)` is the inner one and the first `=>` is the parameter's"
  );
  assert.strictEqual(
    tsLang.returnTypeOf("function k(a: {x: number}): number"),
    "number",
    "an object-type parameter carries a colon inside braces; the first `:` after `(` is the parameter's, not the return's"
  );
  assert.strictEqual(
    tsLang.returnTypeOf("export const g = (a: number): string =>"),
    "string",
    "an arrow function's return type sits between the close paren and the `=>`, so the `=>` terminates rather than introduces it"
  );
  assert.strictEqual(
    tsLang.returnTypeOf("export const g = (cb: (x: number) => number, o: {y: string}): boolean =>"),
    "boolean",
    "all three wrinkles at once still yield the real return type"
  );
});

// ===========================================================================
// 9. Testability, first-match-wins.
//    [contract-ts.md '## Testability': async -> io -> needs-fixture ->
//     not-exported -> underspecified -> testable]
// ===========================================================================

const DOC = "/** Returns twice the given count of shards. */";

ttest("classifyTestability ts: `async function` and a `Promise<T>` return are 'async' [contract-ts.md 'async: `async function`, or a `Promise<T>` return']", () => {
  for (const sig of [
    "export async function load(n: number): Promise<number>",
    "export function load(n: number): Promise<number>",
    "export const load = async (n: number): Promise<number> =>",
  ]) {
    assert.strictEqual(
      tsLang.classifyTestability(sig, DOC).reason,
      "async",
      `${JSON.stringify(sig)} returns a promise, which a blind synchronous assertion cannot express`
    );
  }
});

ttest("classifyTestability ts: `node:fs` and `fetch` in the signature are 'io' [contract-ts.md 'io: `node:fs`, `fs`, `fetch`, `http`, `https` types in the signature']", () => {
  for (const sig of [
    'export function dump(fh: import("node:fs").WriteStream): string',
    "export function get(f: typeof fetch, url: string): string",
    'export function serve(s: import("http").Server): string',
  ]) {
    assert.strictEqual(
      tsLang.classifyTestability(sig, DOC).reason,
      "io",
      `${JSON.stringify(sig)} touches the world and is integration territory dressed as a survivor`
    );
  }
});

ttest("classifyTestability ts: an explicit `this:` parameter is 'needs-fixture', the unambiguous case [contract-ts.md Amendment 4 'an explicit `this:` parameter is the unambiguous case']", () => {
  assert.strictEqual(
    tsLang.classifyTestability("total(this: Store, a: number): number {", DOC).reason,
    "needs-fixture",
    "an explicit `this` parameter is the unambiguous signature-level tell that the unit needs an instance"
  );
});

ttest("classifyTestability ts: the METHOD FORM ITSELF is the tell - no `function` keyword, no arrow binding, no `export` is 'needs-fixture', because the classifier only ever sees a signature and a body-level `this` is not observable. This deliberately OVER-refuses a method that never touches `this`, which is the honest direction and the only reading reaching the measured 100 of 157 [contract-ts.md Amendment 4 'A member declared without the `function` keyword, without an arrow binding and without an `export` is `needs-fixture` ... This OVER-refuses a class method that never touches `this`, and that is the honest direction']", () => {
  for (const sig of ["total(a: number): number {", "public total(a: number): number {"]) {
    assert.strictEqual(
      tsLang.classifyTestability(sig, DOC).reason,
      "needs-fixture",
      `${JSON.stringify(sig)} needs an instance the blind test cannot construct. The alternative to over-refusing is a test that constructs no receiver and fails for a reason the human did not cause`
    );
  }
});

ttest("classifyTestability ts: a NON-EXPORTED function is 'not-exported', THE NEW REASON, and the detail must NAME THE FIX [contract-ts.md 'not-exported: THE NEW REASON ... The `detail` must name the fix: export it, or it stays untestable']", () => {
  const v = tsLang.classifyTestability("function helper(n: number): number {", DOC);
  assert.strictEqual(
    v.reason,
    "not-exported",
    `the sibling test file imports the unit, so a non-exported function cannot be reached at all. Got ${JSON.stringify(v)}`
  );
  assert.strictEqual(typeof v.detail, "string", "a refusal carries a human-facing detail");
  assert.ok(
    /export/i.test(v.detail),
    `the detail must name the fix, and the fix is the word "export". Without it the human is told a function is untestable with no action to take. Got ${JSON.stringify(v.detail)}`
  );
});

ttest("classifyTestability ts: PLAIN `void`, an ABSENT return type and an ABSENT doc comment are each 'underspecified' [contract-ts.md 'underspecified: plain `void`, an absent return type, or no doc comment. NOT `Promise<void>`, which async claims first']", () => {
  assert.strictEqual(
    tsLang.classifyTestability("export function log(n: number): void {", DOC).reason,
    "underspecified",
    "void returns nothing to assert on"
  );
  assert.strictEqual(
    tsLang.classifyTestability("export function h(a: number) {", DOC).reason,
    "underspecified",
    "no return annotation means the gesture cannot say what to assert"
  );
  assert.strictEqual(
    tsLang.classifyTestability("export function widen(n: number): number {", undefined).reason,
    "underspecified",
    "with no contract there is nothing to write a blind test against"
  );
  assert.strictEqual(
    tsLang.classifyTestability("export function widen(n: number): number {", "").reason,
    "underspecified",
    "an empty doc comment is no doc comment"
  );
});

ttest("classifyTestability ts: `Promise<void>` is 'async', NOT 'underspecified' - precedence claims it, and what is being protected is that the reported reason is PREDICTABLE rather than dependent on which legs happen to match. The function is refused either way, so only the sentence changes, and it names the first and most fundamental blocker [contract-ts.md Amendment 3 'This INCLUDES `Promise<void>` ... precedence resolves it to async. The property being protected is that the reported reason is predictable, not the individual verdict']", () => {
  for (const sig of [
    "export function flush(n: number): Promise<void> {",
    "export async function flush(n: number): Promise<void> {",
  ]) {
    assert.strictEqual(
      tsLang.classifyTestability(sig, DOC).reason,
      "async",
      `${JSON.stringify(sig)}: carving an exception out of first-match-wins would make the reason depend on which legs matched, which is exactly the predictability the shipped Rust classifier's header promises`
    );
  }
  assert.strictEqual(
    tsLang.classifyTestability("export function log(n: number): void {", DOC).reason,
    "underspecified",
    "plain void is NOT touched by this ruling: it never reaches the async leg, so underspecified still claims it"
  );
});

ttest("classifyTestability ts: an EXPORTED, documented, non-this, synchronous function with a real return type IS TESTABLE - the leg refuses a great deal, and it must not refuse this [contract-ts.md '## Testability' precedence chain ending in `testable`]", () => {
  for (const sig of [
    "export function widen(n: number): number {",
    "export const widen = (n: number): string =>",
    "export function widen(n: number): Shard {",
  ]) {
    assert.strictEqual(
      tsLang.classifyTestability(sig, DOC).reason,
      undefined,
      `${JSON.stringify(sig)} is the shape the gesture exists for and must not be refused`
    );
  }
});

ttest("classifyTestability ts: first-match-wins precedence holds in the contract's order, so the reported reason is STABLE and repeated calls agree [contract-ts.md 'async -> io -> needs-fixture -> not-exported -> underspecified -> testable']", () => {
  const rows = [
    ["async before io", 'async function dump(fh: import("node:fs").WriteStream): Promise<number>', DOC, "async"],
    ["io before needs-fixture", 'dump(this: Store, fh: import("node:fs").WriteStream): string {', DOC, "io"],
    ["needs-fixture before not-exported", "total(a: number): number {", DOC, "needs-fixture"],
    ["not-exported before underspecified", "function helper(a: number) {", DOC, "not-exported"],
    ["not-exported before underspecified, no doc either", "function helper(a: number): number {", undefined, "not-exported"],
    // Amendment 3's ruling stated as a precedence property rather than as a
    // special case: async is simply reached first.
    ["async before underspecified", "export function flush(n: number): Promise<void> {", DOC, "async"],
    ["async before not-exported", "async function helper(n: number): Promise<number>", DOC, "async"],
  ];
  for (const [label, sig, doc, want] of rows) {
    const first = tsLang.classifyTestability(sig, doc).reason;
    assert.strictEqual(first, want, `${label}: ${JSON.stringify(sig)} reports ${want}, got ${JSON.stringify(first)}`);
    assert.strictEqual(
      tsLang.classifyTestability(sig, doc).reason,
      first,
      `${label}: the same input must classify the same way twice, or the reported reason is not stable`
    );
  }
});

// ===========================================================================
// 10. expectedValueSpans. THE SAFETY-CRITICAL ONE, and its shape is unlike
//     every other language in this build: the expected value is the SOLE
//     ARGUMENT OF THE MATCHER TERMINATING THE `expect` CHAIN, not a positional
//     argument of the call being scanned.
//     [contract-ts.md '## The assertion idiom, and where the blank goes';
//      goal.md item 6]
// ===========================================================================

const spanTexts = (fw, text) => {
  const spans = fw.expectedValueSpans(text);
  assert.ok(Array.isArray(spans), "expectedValueSpans returns an array");
  return spans.map((s) => text.slice(s.start, s.end));
};

const TS_SIMPLE =
  "describe('widen', () => {\n" +
  "  it('doubles its argument', () => {\n" +
  "    expect(widen(3)).toBe(7);\n" +
  "  });\n" +
  "});\n";

ttest("expectedValueSpans ts: EXACTLY ONE span for `expect(widen(3)).toBe(7)`, and it covers `7`. It must NOT cover `widen(3)`, because blanking the call under test deletes the thing being tested and keeps the model's guess as the expectation [contract-ts.md 'Getting it wrong blanks `widen(3)`, the call under test, and leaves the model's guessed value in place, which is the blank-value invariant inverted'; goal.md item 6]", () => {
  const fw = vitestFw();
  const spans = fw.expectedValueSpans(TS_SIMPLE);
  assert.strictEqual(
    spans.length,
    1,
    `one terminating matcher in this body, one span, got ${JSON.stringify(spans.map((s) => TS_SIMPLE.slice(s.start, s.end)))}`
  );
  const covered = TS_SIMPLE.slice(spans[0].start, spans[0].end);
  assert.strictEqual(covered, "7", `the span is the expected VALUE, got ${JSON.stringify(covered)}`);
  assert.ok(
    !covered.includes("widen"),
    `the span must NOT cover widen(3). The expected value is the argument of the method invoked ON the result of expect(...), never a positional argument of the scanned call. Got ${JSON.stringify(covered)}`
  );
  assert.ok(!covered.includes("("), `the span is a value, not a call, got ${JSON.stringify(covered)}`);
});

ttest("expectedValueSpans ts: `expect(a).not.toBe(b)` terminates at `toBe` and the span is `b` - `not` is a chain LINK, not a terminator [contract-ts.md '`expect(a).not.toBe(b)` terminates at `toBe`, and `b` is the span'; 'or `not`, which is a chain link rather than a terminator']", () => {
  const body =
    "it('is not the neighbour', () => {\n" +
    "  expect(widen(3)).not.toBe(8);\n" +
    "});\n";
  assert.deepStrictEqual(
    spanTexts(vitestFw(), body),
    ["8"],
    "the negated matcher still carries the value the human must type"
  );
});

ttest("expectedValueSpans ts: ZERO-ARGUMENT matchers yield NO span - toBeTruthy, toBeNull and toBeUndefined assert a property, not a value the human types [contract-ts.md 'Do NOT match zero-argument matchers (`toBeTruthy`, `toBeNull`, `toBeUndefined`)']", () => {
  const body =
    "it('has no typed expectation', () => {\n" +
    "  expect(widen(3)).toBeTruthy();\n" +
    "  expect(widen(0)).toBeNull();\n" +
    "  expect(widen(-1)).toBeUndefined();\n" +
    "  expect(widen(2)).not.toBeTruthy();\n" +
    "});\n";
  assert.deepStrictEqual(
    spanTexts(vitestFw(), body),
    [],
    "an empty argument list is not an expected value, and inventing a zero-width hole here gives the human a tabstop with nothing to type"
  );
});

ttest("expectedValueSpans ts: toEqual, toStrictEqual, toContain, toHaveLength and toBeCloseTo are ALL terminators, one span each, in source order [contract-ts.md 'Match only value-asserting terminators: `toBe`, `toEqual`, `toStrictEqual`, `toBeCloseTo`, `toContain`, `toHaveLength`']", () => {
  const body =
    "it('every terminator', () => {\n" +
    "  expect(parse(s)).toEqual(1);\n" +
    "  expect(parse(s)).toStrictEqual(2);\n" +
    "  expect(parse(s)).toContain(3);\n" +
    "  expect(parse(s)).toHaveLength(4);\n" +
    "  expect(parse(s)).toBeCloseTo(5);\n" +
    "});\n";
  assert.deepStrictEqual(
    spanTexts(vitestFw(), body),
    ["1", "2", "3", "4", "5"],
    "each value-asserting matcher contributes exactly its sole argument, in source order"
  );
});

ttest("expectedValueSpans ts: a NESTED `expect` inside the matcher argument does not confuse the scanner - one span, covering the WHOLE argument [contract-ts.md 'A nested `expect` inside the matcher argument must not confuse the scanner']", () => {
  const body =
    "it('nested expect', () => {\n" +
    "  expect(compose(1)).toEqual(expect.arrayContaining([2]));\n" +
    "});\n";
  const texts = spanTexts(vitestFw(), body);
  assert.strictEqual(
    texts.length,
    1,
    `the inner expect is part of the argument, not a second assertion. Got ${JSON.stringify(texts)}`
  );
  assert.strictEqual(
    texts[0],
    "expect.arrayContaining([2])",
    `the span is the SOLE argument of toEqual, whole, brackets and all. A scanner that stops at the inner paren corrupts the snippet. Got ${JSON.stringify(texts[0])}`
  );
});

ttest("expectedValueSpans ts: `expect` and matcher names inside a STRING, a `//` COMMENT, a BLOCK comment, and a BACKTICK TEMPLATE LITERAL WITH `${...}` INTERPOLATION CONTAINING NESTED BACKTICKS all yield NO span [contract-ts.md 'Never match `expect` or a matcher name inside a string, a template literal, or a comment. The literal profile needs TypeScript's backtick template literals, INCLUDING `${...}` interpolation which can contain arbitrary expressions and nested backticks']", () => {
  // Every `expect(...)` below is inert text. A scanner without the literal and
  // comment profile finds five assertions here and blanks fragments of strings.
  const body =
    "it('all decoys', () => {\n" +
    '  const dq = "expect(a).toBe(1)";\n' +
    "  const sq = 'expect(a).toEqual(2)';\n" +
    "  // expect(a).toStrictEqual(3)\n" +
    "  /* expect(a).toContain(4) */\n" +
    "  const tpl = `expect(a).toBe(${ `expect(b).toHaveLength(5)` })`;\n" +
    "  void dq; void sq; void tpl;\n" +
    "});\n";
  const texts = spanTexts(vitestFw(), body);
  assert.deepStrictEqual(
    texts,
    [],
    `not one of these is an assertion. The template literal is the hard one: its interpolation carries a NESTED backtick string, and a scanner that terminates the template at the first backtick after the interpolation reads the rest of the file as code. Got ${JSON.stringify(texts)}`
  );
});

ttest("expectedValueSpans ts: a real assertion sitting AFTER the template-literal decoy is still found, so the literal profile resumes at the right place [contract-ts.md 'INCLUDING `${...}` interpolation which can contain arbitrary expressions and nested backticks']", () => {
  const body =
    "it('decoy then real', () => {\n" +
    "  const tpl = `expect(a).toBe(${ `nested ` + `backticks` })`;\n" +
    "  expect(widen(3)).toBe(7);\n" +
    "});\n";
  assert.deepStrictEqual(
    spanTexts(vitestFw(), body),
    ["7"],
    "a scanner that never leaves the template literal reports zero spans; one that leaves it too early reports a span inside the string"
  );
});

ttest("expectedValueSpans ts: spans come back ASCENDING and NON-OVERLAPPING, or blankTestModule's slice loop corrupts the snippet [contract-ts.md 'Spans ascending and non-overlapping, or `blankTestModule`'s slice loop corrupts the snippet']", () => {
  const body =
    "describe('widen', () => {\n" +
    "  it('doubles', () => {\n" +
    "    expect(widen(3)).toBe(6);\n" +
    "  });\n" +
    "  it('is not the neighbour', () => {\n" +
    "    expect(widen(4)).not.toEqual(9);\n" +
    "  });\n" +
    "  it('is truthy', () => {\n" +
    "    expect(widen(1)).toBeTruthy();\n" +
    "  });\n" +
    "});\n";
  const spans = vitestFw().expectedValueSpans(body);
  assert.deepStrictEqual(
    spans.map((s) => body.slice(s.start, s.end)),
    ["6", "9"],
    `two value-asserting matchers and one zero-argument matcher gives two spans. Got ${JSON.stringify(spans.map((s) => body.slice(s.start, s.end)))}`
  );
  for (const s of spans) {
    assert.ok(s.end > s.start, `a span is a non-empty range, got ${JSON.stringify(s)}`);
  }
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(
      spans[i].start >= spans[i - 1].end,
      `ascending and non-overlapping: a consumer applies these in order and overlapping ranges corrupt the document. Got ${JSON.stringify(spans)}`
    );
  }
});

// ===========================================================================
// 11. renderBlankValue. Amendment 2: a SCALAR gets a BARE hole, everything else
//     gets a HINTED hole, and a container's contents are hinted with the
//     ELEMENT type.
//     [contract-ts.md '## Blank values'; goal.md Amendment 2]
// ===========================================================================

const blank = (type) => {
  const res = tsLang.renderBlankValue(type);
  assert.strictEqual(typeof res.holes, "number", `renderBlankValue(${JSON.stringify(type)}) reports a hole count`);
  assert.strictEqual(typeof res.rhs, "string", `renderBlankValue(${JSON.stringify(type)}) renders a right-hand side`);
  return res;
};

ttest("renderBlankValue ts: `number`, `string`, `boolean` and `bigint` are ONE BARE hole with NO `/*` in them - the bare side of the bare-versus-hinted rule [contract-ts.md '`number`, `string`, `boolean`, `bigint` | one BARE hole'; goal.md Amendment 2 'a SCALAR gets a bare hole']", () => {
  for (const type of ["number", "string", "boolean", "bigint"]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.strictEqual(
      res.rhs,
      "${1}",
      `${type}: a scalar's own name is no help to the human, so the hole carries no comment. Got ${JSON.stringify(res.rhs)}`
    );
    assert.ok(
      !res.rhs.includes("/*"),
      `${type}: no type-hint comment on a scalar, got ${JSON.stringify(res.rhs)}`
    );
  }
});

ttest("renderBlankValue ts: `T[]` and `Array<T>` render `[${1:/* T */}]` - the array literal is scaffolded and its contents are ONE HINTED hole carrying the ELEMENT type, not the container type [contract-ts.md '`T[]` and `Array<T>` | `[${1:/* T */}]`'; goal.md Amendment 2 'a container's contents are hinted with the ELEMENT type']", () => {
  for (const [type, element] of [
    ["number[]", "number"],
    ["string[]", "string"],
    ["Array<number>", "number"],
    ["Array<Shard>", "Shard"],
  ]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type}: the literal is scaffolded, the contents are one hole`);
    assert.ok(res.rhs.startsWith("["), `${type}: the type scaffolds its own array literal, got ${JSON.stringify(res.rhs)}`);
    assert.ok(res.rhs.endsWith("]"), `${type}: the literal is closed, got ${JSON.stringify(res.rhs)}`);
    assert.strictEqual(
      res.rhs,
      `[\${1:/* ${element} */}]`,
      `${type}: the contents hole hints the ELEMENT type, because the human is typing a ${element}, not a ${type}. Got ${JSON.stringify(res.rhs)}`
    );
  }
});

ttest("renderBlankValue ts: an INLINE OBJECT TYPE scaffolds its keys with ONE HOLE EACH, the way the Rust struct branch scaffolds fields [contract-ts.md 'an inline object type `{a: number, b: string}` | scaffold the keys, one hole each, like the Rust struct branch']", () => {
  const res = blank("{a: number, b: string}");
  assert.strictEqual(
    res.holes,
    2,
    `two keys, two holes: the TYPE determines the shape, so the shape is scaffolded and only the values are left to type. Got ${res.holes} from ${JSON.stringify(res.rhs)}`
  );
  assert.ok(/\ba\b/.test(res.rhs), `the first key is scaffolded, got ${JSON.stringify(res.rhs)}`);
  assert.ok(/\bb\b/.test(res.rhs), `the second key is scaffolded, got ${JSON.stringify(res.rhs)}`);
  assert.ok(res.rhs.includes("${1"), `the first hole is numbered 1, got ${JSON.stringify(res.rhs)}`);
  assert.ok(res.rhs.includes("${2"), `the second hole is numbered 2, got ${JSON.stringify(res.rhs)}`);
  assert.ok(
    !/^\$\{1[:}]/.test(res.rhs),
    `an inline object is NOT collapsed to one hole; the keys are known from the type and the human should not retype them. Got ${JSON.stringify(res.rhs)}`
  );
});

ttest("renderBlankValue ts: `Record`, `Map`, `Set`, a NAMED type and a UNION are each ONE HINTED hole naming the type - the hinted side of the bare-versus-hinted rule, and for the union the variant IS the answer [contract-ts.md '`Record<K,V>`, `Map<K,V>`, `Set<T>` | one HINTED hole'; 'a named type or interface | one HINTED hole'; 'a union `A | B` | one HINTED hole. The variant IS the answer, the Option/Result precedent']", () => {
  for (const [type, mustName] of [
    ["Record<string, number>", "Record"],
    ["Map<string, number>", "Map"],
    ["Set<number>", "Set"],
    ["Shard", "Shard"],
    ["number | string", "number"],
  ]) {
    const res = blank(type);
    assert.strictEqual(res.holes, 1, `${type} is one hole`);
    assert.ok(
      res.rhs.startsWith("${1:/*"),
      `${type}: the hole carries a type-hint comment, because the hint is the only thing telling the human what shape to type. Got ${JSON.stringify(res.rhs)}`
    );
    assert.ok(
      res.rhs.includes(mustName),
      `${type}: the hint names the type, got ${JSON.stringify(res.rhs)}`
    );
  }
  const union = blank("number | string");
  assert.ok(
    union.rhs.includes("string"),
    `a union hints BOTH variants, because choosing one is the contract's decision and not the type's. Got ${JSON.stringify(union.rhs)}`
  );
});

// ===========================================================================
// 12. Scaffold. The vitest imports, the subject import, the fence, and
//     generatedTestNames reading the `it` TITLE.
//     [contract-ts.md '## Scaffold']
// ===========================================================================

const GENERATED_TESTS =
  "describe('widen', () => {\n" +
  "  it('widen doubles its argument', () => {\n" +
  "    expect(widen(3)).toBe(6);\n" +
  "  });\n" +
  "});\n";

const MARKER_ID = "widen-1";

const scaffoldFor = (existingText, deps) => {
  const placement = placeOk(SRC, SYMBOL, deps);
  const plan = tsLang.scaffold({
    existingText,
    generatedTests: GENERATED_TESTS,
    markerId: MARKER_ID,
    placement,
    deps,
  });
  assert.strictEqual(typeof plan.start, "number", "start is an offset into the target document");
  assert.strictEqual(typeof plan.end, "number", "end is an offset into the target document");
  assert.ok(plan.end >= plan.start, "the replaced range is not inverted");
  assert.strictEqual(typeof plan.text, "string", "text is what gets written");
  return plan;
};

ttest("scaffold ts: a NEW file declares the vitest imports AND the subject import, and the subject import matches the placement's importLine [contract-ts.md 'New file: `import { describe, expect, it } from 'vitest'; import { widen } from './foo';']", () => {
  const plan = scaffoldFor("", DEPS);
  const out = applyPlan("", plan);

  assert.ok(
    /from\s+['"]vitest['"]/.test(out),
    `the runner's own names must be imported or nothing resolves, got ${JSON.stringify(out)}`
  );
  for (const name of ["describe", "expect", "it"]) {
    assert.ok(out.includes(name), `the vitest import brings in ${name}, got ${JSON.stringify(out)}`);
  }
  assert.ok(
    /from\s+['"]\.\/foo['"]/.test(out),
    `the subject import reaches the unit under test through ./foo, got ${JSON.stringify(out)}`
  );
  assert.ok(out.includes(SYMBOL), "the symbol under test is imported by name");
});

ttest("scaffold ts: a NEW file fences the generated tests in `// column80-tests:<id>:begin` and `:end`, commented with markerPrefix [contract-ts.md '// column80-tests:<id>:begin ... :end']", () => {
  const plan = scaffoldFor("", DEPS);
  const out = applyPlan("", plan);

  for (const suffix of ["begin", "end"]) {
    const marker = `column80-tests:${MARKER_ID}:${suffix}`;
    assert.ok(out.includes(marker), `the ${suffix} marker is present, got ${JSON.stringify(out)}`);
    const line = out.split("\n").find((l) => l.includes(marker));
    assert.ok(
      line.trim().startsWith(tsLang.markerPrefix),
      `the ${suffix} marker is a comment using markerPrefix, got ${JSON.stringify(line)}`
    );
  }

  const begin = out.indexOf(`column80-tests:${MARKER_ID}:begin`);
  const body = out.indexOf("widen doubles its argument");
  const end = out.indexOf(`column80-tests:${MARKER_ID}:end`);
  assert.ok(
    body > begin && body < end,
    "the generated tests sit INSIDE the fence, or the region cannot be replaced later"
  );
});

ttest("scaffold ts: generatedTestNames reads the `it(...)` TITLE, not a function name - a real difference from Rust and Go, where the name is an identifier [contract-ts.md '`generatedTestNames` reads `it\\(\\s*['\\\"`]([^'\\\"`]+)` inside the marked region, because the name the rung filters on is the `it` TITLE, not a function name']", () => {
  const plan = scaffoldFor("", DEPS);
  const out = applyPlan("", plan);
  const names = tsLang.generatedTestNames(out, MARKER_ID);
  assert.deepStrictEqual(
    names,
    ["widen doubles its argument"],
    `the round trip recovers the it TITLE, spaces and all, because that is exactly what -t filters on. Got ${JSON.stringify(names)}`
  );
  assert.ok(
    !names.includes("widen"),
    "the describe title is not a test name, and neither is the symbol; filtering on either selects the wrong set"
  );
  assert.deepStrictEqual(
    tsLang.generatedTestNames(out, "some-other-id"),
    [],
    "a different markerId sees none of this region's tests"
  );
});

ttest("scaffold ts: extending a file that ALREADY imports vitest must NOT duplicate the import, and the developer's own tests survive untouched [contract-ts.md 'Existing file: ... `extend-existing` appending the marked region, adding any missing import without duplicating one already present']", () => {
  const existing =
    "import { describe, expect, it } from 'vitest';\n" +
    "import { widen } from './foo';\n" +
    "\n" +
    "describe('widen', () => {\n" +
    "  it('a human wrote this one', () => {\n" +
    "    expect(widen(1)).toBe(2);\n" +
    "  });\n" +
    "});\n";
  const plan = scaffoldFor(existing, DEPS_TARGET_EXISTS);
  assert.strictEqual(
    plan.mode,
    "extend-existing",
    `no marked region exists, so the plan appends one, got ${JSON.stringify(plan.mode)}`
  );
  const out = applyPlan(existing, plan);

  const vitestImports = (out.match(/from\s+['"]vitest['"]/g) || []).length;
  assert.strictEqual(
    vitestImports,
    1,
    `a duplicate import of the same names is a redeclaration the human's accepted file would not run. Got ${vitestImports} occurrences in ${JSON.stringify(out)}`
  );
  const subjectImports = (out.match(/from\s+['"]\.\/foo['"]/g) || []).length;
  assert.strictEqual(subjectImports, 1, `the subject import is not duplicated either, got ${JSON.stringify(out)}`);

  assert.ok(out.includes("a human wrote this one"), "the developer's own test survives untouched");
  assert.ok(out.includes("widen doubles its argument"), "the generated test rides into the plan");
  assert.ok(
    out.includes(`column80-tests:${MARKER_ID}:begin`),
    "the appended region is fenced so it can be replaced next time"
  );

  assert.deepStrictEqual(
    tsLang.generatedTestNames(out, MARKER_ID),
    ["widen doubles its argument"],
    "generatedTestNames is SCOPED to the marked region: the human's own it title must never be selected by the rung's filter"
  );
});
